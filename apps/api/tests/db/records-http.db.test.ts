import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import type { Auth } from "better-auth";
import type { TestHelpers } from "better-auth/plugins";
import { testUtils } from "better-auth/plugins";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { closePool, getPool } from "../../src/infrastructure/database/pool";
import { createAuth } from "../../src/modules/identity/infrastructure/better-auth";
import {
  createRoles,
  migrateAsMigrator,
  startPostgres,
  type TestDatabase,
} from "../support/database";
import { createHttpTestApp } from "../support/nest-app";

const ORIGIN = "http://localhost:3000";

const AUTH_ENV = {
  DATABASE_URL: "",
  PUBLIC_APP_ORIGIN: ORIGIN,
  BETTER_AUTH_SECRET: "test-secret-for-db-tests-only",
  GOOGLE_CLIENT_ID: "test-google-client-id",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
};

type FixtureUser = { userId: string; sub: string };

let db: TestDatabase;
let app: NestExpressApplication;
let auth: Auth;
let testHelpers: TestHelpers;
let runtimePool: Pool;
let hinata: FixtureUser;
let aoi: FixtureUser;
let hinataCookie: string;

function http() {
  return request(app.getHttpServer());
}

function authed(req: request.Test, cookie: string): request.Test {
  return req
    .set("Cookie", cookie)
    .set("Origin", ORIGIN)
    .set("Content-Type", "application/json");
}

function newKey(): string {
  return crypto.randomUUID();
}

async function login(userId: string): Promise<string> {
  const result = await testHelpers.login({ userId });
  const cookie = result.headers.get("cookie");
  if (cookie === null) {
    throw new Error("login did not produce a cookie header");
  }
  return cookie;
}

async function insertUser(name: string, email: string): Promise<string> {
  const result = await db.admin.query<{ id: string }>(
    "INSERT INTO identity.users (name, email, email_verified) VALUES ($1, $2, TRUE) RETURNING id",
    [name, email],
  );
  return result.rows[0]!.id;
}

async function insertGoogleAccount(userId: string, sub: string): Promise<void> {
  await db.admin.query(
    "INSERT INTO identity.accounts (account_id, provider_id, user_id) VALUES ($1, 'google', $2)",
    [sub, userId],
  );
}

async function insertAllowlist(
  slot: number,
  userId: string,
  sub: string,
): Promise<void> {
  await db.admin.query(
    `INSERT INTO identity.allowed_google_accounts (slot, user_id, google_sub, enabled)
     VALUES ($1, $2, $3, TRUE)`,
    [slot, userId, sub],
  );
}

const TRIP_BODY = {
  name: "京都 2 泊",
  startsOn: "2026-09-10",
  endsOn: "2026-09-12",
};

async function createTrip(
  cookie: string,
  overrides: Partial<typeof TRIP_BODY> = {},
): Promise<string> {
  const response = await authed(http().post("/api/trips"), cookie)
    .set("Idempotency-Key", newKey())
    .send({ ...TRIP_BODY, ...overrides });
  expect(response.status).toBe(201);
  return response.body.id as string;
}

async function createPlan(
  cookie: string,
  tripId: string,
  body: Record<string, unknown>,
): Promise<string> {
  const response = await authed(http().post(`/api/trips/${tripId}/plans`), cookie)
    .set("Idempotency-Key", newKey())
    .send(body);
  expect(response.status).toBe(201);
  return response.body.id as string;
}

async function listRecords(
  cookie: string,
  tripId: string,
  query = "",
): Promise<request.Response> {
  return authed(http().get(`/api/trips/${tripId}/records${query}`), cookie);
}

type SeedSpec = {
  kind: "payment" | "achievement" | "booking";
  at: string;
  actor?: string;
  planId?: string | null;
};

/**
 * 元の記録を直接DBに入れてidを返す（達成・予約のAPIは並行するPRのため、
 * plan_eventsはSQLで種を入れる。支払いのinsert形式はpaymentsの試験と同じ）。
 */
async function seedRecord(
  tripId: string,
  spec: SeedSpec,
): Promise<string> {
  const actor = spec.actor ?? hinata.userId;
  if (spec.kind === "payment") {
    const result = await db.admin.query<{ id: string }>(
      `INSERT INTO record.payments (trip_id, plan_id, amount_yen, payer_slot, slot0_percent,
         slot0_burden_yen, slot1_burden_yen, contribution_yen, created_by, created_at)
       VALUES ($1, $2, 7001, 0, 50, 3501, 3500, 3500, $3, $4) RETURNING id`,
      [tripId, spec.planId ?? null, actor, spec.at],
    );
    return result.rows[0]!.id;
  }
  const result = await db.admin.query<{ id: string }>(
    `INSERT INTO record.plan_events (trip_id, plan_id, event_kind, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tripId, spec.planId ?? null, spec.kind, actor, spec.at],
  );
  return result.rows[0]!.id;
}

/** 取り消しを直接DBに入れる（idは元の記録と同じになる）。 */
async function seedCancellation(
  tripId: string,
  kind: "payment" | "achievement" | "booking",
  recordId: string,
  cancelledBy: string,
  at: string,
): Promise<void> {
  if (kind === "payment") {
    await db.admin.query(
      `INSERT INTO record.payment_cancellations (payment_id, trip_id, cancelled_by, created_at)
       VALUES ($1, $2, $3, $4)`,
      [recordId, tripId, cancelledBy, at],
    );
    return;
  }
  await db.admin.query(
    `INSERT INTO record.plan_event_cancellations (event_id, trip_id, cancelled_by, created_at)
     VALUES ($1, $2, $3, $4)`,
    [recordId, tripId, cancelledBy, at],
  );
}

async function createPayment(
  cookie: string,
  tripId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await authed(
    http().post(`/api/trips/${tripId}/payments`),
    cookie,
  )
    .set("Idempotency-Key", newKey())
    .send({
      amountYen: "7001",
      payerUserId: hinata.userId,
      allocations: [
        { userId: hinata.userId, percent: 50 },
        { userId: aoi.userId, percent: 50 },
      ],
      ...overrides,
    });
  expect(response.status).toBe(201);
  return response.body.id as string;
}

/** 支払い→確認→精算をAPIで流して、精算の履歴の行を作る。 */
async function settleOnePayment(
  cookie: string,
  tripId: string,
): Promise<string> {
  const paymentId = await createPayment(cookie, tripId);
  const preview = await authed(
    http().post(`/api/trips/${tripId}/settlement-previews`),
    cookie,
  ).set("Idempotency-Key", newKey());
  expect(preview.status).toBe(201);
  const settled = await authed(
    http().post(`/api/trips/${tripId}/settlements`),
    cookie,
  )
    .set("Idempotency-Key", newKey())
    .send({
      previewId: preview.body.id,
      completionKind: "transfer_completed",
      acknowledgedCancellationPaymentIds: [],
    });
  expect(settled.status).toBe(201);
  return paymentId;
}

/** ひなたが参加しない旅行を別利用者2人で直接作る。 */
async function seedForeignTrip(): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const u0 = await insertUser(`foreign-${suffix}-0`, `foreign-${suffix}-0@example.test`);
  const u1 = await insertUser(`foreign-${suffix}-1`, `foreign-${suffix}-1@example.test`);
  const trip = await db.admin.query<{ id: string }>(
    "INSERT INTO planning.trips (name, starts_on, ends_on, created_by) VALUES ('関係ない旅行', '2026-10-01', '2026-10-02', $1) RETURNING id",
    [u0],
  );
  const tripId = trip.rows[0]!.id;
  await db.admin.query(
    "INSERT INTO planning.trip_participants (trip_id, slot, user_id) VALUES ($1, 0, $2), ($1, 1, $3)",
    [tripId, u0, u1],
  );
  return tripId;
}

beforeAll(async () => {
  db = await startPostgres();
  await createRoles(db);
  await migrateAsMigrator(db);

  AUTH_ENV.DATABASE_URL = db.urlFor("app_runtime");
  for (const [key, value] of Object.entries(AUTH_ENV)) {
    process.env[key] = value;
  }

  runtimePool = getPool();
  for (const pool of [runtimePool, db.admin]) {
    pool.on("error", () => {});
  }
  auth = createAuth(
    {
      baseURL: ORIGIN,
      secret: AUTH_ENV.BETTER_AUTH_SECRET,
      googleClientId: AUTH_ENV.GOOGLE_CLIENT_ID,
      googleClientSecret: AUTH_ENV.GOOGLE_CLIENT_SECRET,
      useSecureCookies: false,
    },
    runtimePool,
    { plugins: [testUtils()] },
  );
  testHelpers = ((await auth.$context) as unknown as { test: TestHelpers })
    .test;

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = await createHttpTestApp(moduleRef, auth);

  const hinataId = await insertUser("ひなた", "hinata@example.test");
  hinata = { userId: hinataId, sub: "test-sub-0" };
  await insertGoogleAccount(hinata.userId, hinata.sub);
  await insertAllowlist(0, hinata.userId, hinata.sub);
  const aoiId = await insertUser("あおい", "aoi@example.test");
  aoi = { userId: aoiId, sub: "test-sub-1" };
  await insertGoogleAccount(aoi.userId, aoi.sub);
  await insertAllowlist(1, aoi.userId, aoi.sub);

  hinataCookie = await login(hinata.userId);
});

afterAll(async () => {
  await app?.close();
  await closePool();
  await db?.stop();
  for (const key of Object.keys(AUTH_ENV)) {
    delete process.env[key];
  }
});

describe("記録の一覧の並び（RD-10）", () => {
  it("支払い・達成・予約と各取り消しを登録日時の新しい順・同じ日時は種類・IDの順に返す", async () => {
    const tripId = await createTrip(hinataCookie);
    const planId = await createPlan(hinataCookie, tripId, {
      name: "清水寺",
      kind: "place",
      date: "2026-09-11",
    });
    const paymentId = await seedRecord(tripId, {
      kind: "payment",
      at: "2026-09-05T10:00:00Z",
    });
    const achievementId = await seedRecord(tripId, {
      kind: "achievement",
      at: "2026-09-05T11:00:00Z",
      actor: aoi.userId,
      planId,
    });
    const bookingId = await seedRecord(tripId, {
      kind: "booking",
      at: "2026-09-05T12:00:00Z",
      planId,
    });
    await seedCancellation(
      tripId,
      "payment",
      paymentId,
      aoi.userId,
      "2026-09-05T13:00:00Z",
    );
    await seedCancellation(
      tripId,
      "achievement",
      achievementId,
      hinata.userId,
      "2026-09-05T14:00:00Z",
    );

    const response = await listRecords(hinataCookie, tripId);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(
      response.body.items.map((item: { kind: string }) => item.kind),
    ).toEqual([
      "achievement_cancellation",
      "payment_cancellation",
      "booking",
      "achievement",
      "payment",
    ]);
    // 取り消しの行はidとtargetIdが元の記録と同じ値
    const paymentCancellation = response.body.items[1];
    expect(paymentCancellation.id).toBe(paymentId);
    expect(paymentCancellation.targetId).toBe(paymentId);
    expect(paymentCancellation.actorId).toBe(aoi.userId);
    expect(paymentCancellation.detail).toMatchObject({
      targetId: paymentId,
      cancelledBy: aoi.userId,
    });
    // 元の記録は種類ごとの中身。支払いは金額と負担、達成は予定のIDを持つ
    expect(response.body.items[4].detail).toMatchObject({
      id: paymentId,
      amountYen: "7001",
      cancellation: { targetId: paymentId, cancelledBy: aoi.userId },
    });
    expect(response.body.items[3].detail).toMatchObject({
      id: achievementId,
      planId,
      kind: "achievement",
      cancellation: { targetId: achievementId, cancelledBy: hinata.userId },
    });
    expect(response.body.items[2].detail).toMatchObject({
      id: bookingId,
      kind: "booking",
      cancellation: null,
    });
    expect(response.body.nextCursor).toBeNull();
  });

  it("同じ日時の元の記録と取り消しは取り消しが先に来る", async () => {
    const tripId = await createTrip(hinataCookie);
    const paymentId = await seedRecord(tripId, {
      kind: "payment",
      at: "2026-09-05T10:00:00Z",
    });
    await seedCancellation(
      tripId,
      "payment",
      paymentId,
      aoi.userId,
      "2026-09-05T10:00:00Z",
    );

    const response = await listRecords(hinataCookie, tripId);

    expect(response.status).toBe(200);
    expect(
      response.body.items.map((item: { kind: string }) => item.kind),
    ).toEqual(["payment_cancellation", "payment"]);
  });

  it("精算の履歴は記録の一覧に出ない", async () => {
    const tripId = await createTrip(hinataCookie);
    const paymentId = await settleOnePayment(hinataCookie, tripId);

    const response = await listRecords(hinataCookie, tripId);

    expect(response.status).toBe(200);
    expect(
      response.body.items.map((item: { kind: string; id: string }) => [
        item.kind,
        item.id,
      ]),
    ).toEqual([["payment", paymentId]]);
  });
});

describe("記録の一覧の絞り込み（RD-11）", () => {
  it("種類・予定・両方で絞る。取り消しの行も絞り込みに従う", async () => {
    const tripId = await createTrip(hinataCookie);
    const planA = await createPlan(hinataCookie, tripId, {
      name: "清水寺",
      kind: "place",
      date: "2026-09-11",
    });
    const planB = await createPlan(hinataCookie, tripId, {
      name: "祇園の夕食",
      kind: "food",
      date: "2026-09-11",
    });
    const paymentA = await seedRecord(tripId, {
      kind: "payment",
      at: "2026-09-05T10:00:00Z",
      planId: planA,
    });
    const paymentNoPlan = await seedRecord(tripId, {
      kind: "payment",
      at: "2026-09-05T11:00:00Z",
    });
    const achievementA = await seedRecord(tripId, {
      kind: "achievement",
      at: "2026-09-05T12:00:00Z",
      planId: planA,
    });
    const bookingB = await seedRecord(tripId, {
      kind: "booking",
      at: "2026-09-05T13:00:00Z",
      planId: planB,
    });
    await seedCancellation(
      tripId,
      "payment",
      paymentA,
      aoi.userId,
      "2026-09-05T14:00:00Z",
    );
    await seedCancellation(
      tripId,
      "achievement",
      achievementA,
      hinata.userId,
      "2026-09-05T15:00:00Z",
    );

    const kinds = async (query: string) => {
      const response = await listRecords(hinataCookie, tripId, query);
      expect(response.status).toBe(200);
      return response.body.items.map(
        (item: { kind: string; id: string }) => [item.kind, item.id] as const,
      );
    };

    // 種類だけ: 支払いと支払いの取り消しだけ（達成・予約は出ない）
    expect(await kinds("?type=payment")).toEqual([
      ["payment_cancellation", paymentA],
      ["payment", paymentNoPlan],
      ["payment", paymentA],
    ]);
    // 達成に絞ると達成とその取り消しだけ
    expect(await kinds("?type=achievement")).toEqual([
      ["achievement_cancellation", achievementA],
      ["achievement", achievementA],
    ]);
    // 予定だけ: その予定の記録と取り消し（予定の無い支払いは出ない）
    expect(await kinds(`?planId=${planA}`)).toEqual([
      ["achievement_cancellation", achievementA],
      ["payment_cancellation", paymentA],
      ["achievement", achievementA],
      ["payment", paymentA],
    ]);
    // 両方: 予定Bの予約だけ
    expect(await kinds(`?type=booking&planId=${planB}`)).toEqual([
      ["booking", bookingB],
    ]);
    expect(await kinds(`?type=booking&planId=${planA}`)).toEqual([]);
  });
});

describe("記録の一覧の読み足し（RD-12）", () => {
  it("limit件ずつカーソルで続きを読み、最後のページでnextCursorがnull", async () => {
    const tripId = await createTrip(hinataCookie);
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      ids.push(
        await seedRecord(tripId, {
          kind: "payment",
          at: `2026-09-05T10:0${i}:00Z`,
        }),
      );
    }

    const seen: string[] = [];
    let cursor = "";
    for (let page = 0; page < 3; page += 1) {
      const response = await listRecords(
        hinataCookie,
        tripId,
        `?limit=2${cursor === "" ? "" : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      expect(response.status).toBe(200);
      seen.push(
        ...response.body.items.map((item: { id: string }) => item.id),
      );
      cursor = response.body.nextCursor;
      if (page < 2) {
        expect(cursor).not.toBeNull();
      } else {
        expect(cursor).toBeNull();
      }
    }
    // 新しい順に5件全部、重なりも抜けも無い
    expect(seen).toEqual([...ids].reverse());
  });

  it("同じ日時の行がページをまたいでも重ならず欠けない（RU-04の実DB）", async () => {
    const tripId = await createTrip(hinataCookie);
    const paymentId = await seedRecord(tripId, {
      kind: "payment",
      at: "2026-09-05T10:00:00Z",
    });
    await seedCancellation(
      tripId,
      "payment",
      paymentId,
      aoi.userId,
      "2026-09-05T10:00:00Z",
    );
    const olderId = await seedRecord(tripId, {
      kind: "payment",
      at: "2026-09-05T09:00:00Z",
    });

    const seen: { kind: string; id: string }[] = [];
    let cursor = "";
    for (let page = 0; page < 3; page += 1) {
      const response = await listRecords(
        hinataCookie,
        tripId,
        `?limit=1${cursor === "" ? "" : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      expect(response.status).toBe(200);
      seen.push(...response.body.items);
      cursor = response.body.nextCursor;
      if (page === 2) {
        expect(cursor).toBeNull();
      }
    }
    // 取り消しと元の記録は同じ日時・同じID。ページの境目で種類が起点を区別する
    expect(seen).toEqual([
      expect.objectContaining({ kind: "payment_cancellation", id: paymentId }),
      expect.objectContaining({ kind: "payment", id: paymentId }),
      expect.objectContaining({ kind: "payment", id: olderId }),
    ]);
  });

  it("別の絞り込みに紐付くカーソルは400", async () => {
    const tripId = await createTrip(hinataCookie);
    await seedRecord(tripId, {
      kind: "payment",
      at: "2026-09-05T10:00:00Z",
    });
    await seedRecord(tripId, {
      kind: "payment",
      at: "2026-09-05T11:00:00Z",
    });
    const first = await listRecords(hinataCookie, tripId, "?limit=1");
    const cursor = first.body.nextCursor as string;
    expect(cursor).not.toBeNull();

    // 種類を変えた要求にそのまま渡すと400
    const wrongType = await listRecords(
      hinataCookie,
      tripId,
      `?type=payment&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.code).toBe("INVALID_REQUEST");
  });
});

describe("記録の一覧の1件に絞る表示（RD-13）", () => {
  it("取り消した支払いは元の記録とその取り消しの2件を返し、nextCursorはnull", async () => {
    const tripId = await createTrip(hinataCookie);
    const paymentId = await seedRecord(tripId, {
      kind: "payment",
      at: "2026-09-05T10:00:00Z",
    });
    await seedCancellation(
      tripId,
      "payment",
      paymentId,
      aoi.userId,
      "2026-09-05T13:00:00Z",
    );

    const response = await listRecords(
      hinataCookie,
      tripId,
      `?type=payment&recordId=${paymentId}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.nextCursor).toBeNull();
    expect(
      response.body.items.map((item: { kind: string }) => item.kind),
    ).toEqual(["payment_cancellation", "payment"]);
    expect(response.body.items[1].detail).toMatchObject({
      id: paymentId,
      amountYen: "7001",
      cancellation: { targetId: paymentId, cancelledBy: aoi.userId },
    });
  });

  it("取り消していない記録は1件だけ。該当なし・種類違い・予定違いは200の空配列", async () => {
    const tripId = await createTrip(hinataCookie);
    const planId = await createPlan(hinataCookie, tripId, {
      name: "清水寺",
      kind: "place",
      date: "2026-09-11",
    });
    const achievementId = await seedRecord(tripId, {
      kind: "achievement",
      at: "2026-09-05T11:00:00Z",
      planId,
    });
    const paymentId = await seedRecord(tripId, {
      kind: "payment",
      at: "2026-09-05T10:00:00Z",
    });

    const single = await listRecords(
      hinataCookie,
      tripId,
      `?type=achievement&recordId=${achievementId}`,
    );
    expect(single.status).toBe(200);
    expect(single.body.items).toHaveLength(1);
    expect(single.body.items[0]).toMatchObject({
      kind: "achievement",
      id: achievementId,
      detail: { id: achievementId, kind: "achievement", cancellation: null },
    });

    // 無いID・種類の違うID・違う予定のAND条件はどれも200の空配列
    for (const query of [
      `?type=payment&recordId=${crypto.randomUUID()}`,
      `?type=achievement&recordId=${paymentId}`,
      `?type=achievement&recordId=${achievementId}&planId=${crypto.randomUUID()}`,
    ]) {
      const response = await listRecords(hinataCookie, tripId, query);
      expect(response.status).toBe(200);
      expect(response.body.items).toEqual([]);
      expect(response.body.nextCursor).toBeNull();
    }
  });

  it("recordIdはtypeが必須でcursor・limitと一緒に使えない（400）", async () => {
    const tripId = await createTrip(hinataCookie);
    const paymentId = await seedRecord(tripId, {
      kind: "payment",
      at: "2026-09-05T10:00:00Z",
    });
    await seedRecord(tripId, {
      kind: "payment",
      at: "2026-09-05T11:00:00Z",
    });
    const cursorPage = await listRecords(hinataCookie, tripId, "?limit=1");
    const cursor = cursorPage.body.nextCursor as string;
    expect(cursor).not.toBeNull();

    for (const query of [
      `?recordId=${paymentId}`,
      `?type=payment&recordId=${paymentId}&cursor=${encodeURIComponent(cursor)}`,
      `?type=payment&recordId=${paymentId}&limit=20`,
    ]) {
      const response = await listRecords(hinataCookie, tripId, query);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("INVALID_REQUEST");
    }
  });
});

describe("記録の一覧の権限（RD-14）", () => {
  it("参加しない・存在しない旅行は同じ403で、記録の有無を漏らさない", async () => {
    const foreignTripId = await seedForeignTrip();
    const record = await db.admin.query<{ id: string }>(
      `INSERT INTO record.payments (trip_id, amount_yen, payer_slot, slot0_percent,
         slot0_burden_yen, slot1_burden_yen, contribution_yen, created_by)
       SELECT $1, 7001, 0, 50, 3501, 3500, 3500, user_id
         FROM planning.trip_participants WHERE trip_id = $1 AND slot = 0
       RETURNING id`,
      [foreignTripId],
    );
    expect(record.rows).toHaveLength(1);

    const foreign = await listRecords(hinataCookie, foreignTripId);
    const missing = await listRecords(hinataCookie, crypto.randomUUID());
    expect(foreign.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(foreign.body).toMatchObject({ code: missing.body.code });
    expect(foreign.body.code).toBe(missing.body.code);
  });

  it("別の旅行の記録ID・存在しないIDはどちらも200の空配列（あるかどうかを漏らさない）", async () => {
    const foreignTripId = await seedForeignTrip();
    const foreignPayment = await db.admin.query<{ id: string }>(
      `INSERT INTO record.payments (trip_id, amount_yen, payer_slot, slot0_percent,
         slot0_burden_yen, slot1_burden_yen, contribution_yen, created_by)
       SELECT $1, 7001, 0, 50, 3501, 3500, 3500, user_id
         FROM planning.trip_participants WHERE trip_id = $1 AND slot = 0
       RETURNING id`,
      [foreignTripId],
    );
    const foreignPaymentId = foreignPayment.rows[0]!.id;

    const tripId = await createTrip(hinataCookie);
    for (const recordId of [foreignPaymentId, crypto.randomUUID()]) {
      const response = await listRecords(
        hinataCookie,
        tripId,
        `?type=payment&recordId=${recordId}`,
      );
      expect(response.status).toBe(200);
      expect(response.body.items).toEqual([]);
      expect(response.body.nextCursor).toBeNull();
    }
  });

  it("別の旅行の行を起点にしたカーソルは400", async () => {
    const foreignTripId = await seedForeignTrip();
    await db.admin.query(
      `INSERT INTO record.payments (trip_id, amount_yen, payer_slot, slot0_percent,
         slot0_burden_yen, slot1_burden_yen, contribution_yen, created_by)
       SELECT $1, 7001, 0, 50, 3501, 3500, 3500, user_id
         FROM planning.trip_participants WHERE trip_id = $1 AND slot = 0`,
      [foreignTripId],
    );
    // 別の旅行で発行したカーソルをこの旅行の続きに使えない
    const foreignPage = await db.admin.query<{ id: string }>(
      "SELECT id FROM record.payments WHERE trip_id = $1",
      [foreignTripId],
    );
    expect(foreignPage.rows).toHaveLength(1);

    const tripId = await createTrip(hinataCookie);
    const paymentId = await seedRecord(tripId, {
      kind: "payment",
      at: "2026-09-05T10:00:00Z",
    });

    // 起点がこの旅行に無い行を指す偽のカーソル
    const forged = Buffer.from(
      JSON.stringify({
        t: tripId,
        y: null,
        p: null,
        k: "payment",
        i: foreignPage.rows[0]!.id,
      }),
    ).toString("base64url");
    const forgedResponse = await listRecords(
      hinataCookie,
      tripId,
      `?cursor=${encodeURIComponent(forged)}`,
    );
    expect(forgedResponse.status).toBe(400);
    expect(forgedResponse.body.code).toBe("INVALID_REQUEST");

    // 別の旅行に紐付くカーソル（旅行のIDが違う）
    const otherTripCursor = Buffer.from(
      JSON.stringify({
        t: foreignTripId,
        y: null,
        p: null,
        k: "payment",
        i: paymentId,
      }),
    ).toString("base64url");
    const otherTrip = await listRecords(
      hinataCookie,
      tripId,
      `?cursor=${encodeURIComponent(otherTripCursor)}`,
    );
    expect(otherTrip.status).toBe(400);
    expect(otherTrip.body.code).toBe("INVALID_REQUEST");
  });

  it("認証なしは401", async () => {
    const tripId = await createTrip(hinataCookie);
    const response = await http()
      .get(`/api/trips/${tripId}/records`)
      .set("Origin", ORIGIN);
    expect(response.status).toBe(401);
  });
});

describe("記録の一覧のキャッシュと性能（RD-19の記録分）", () => {
  it("支払い200件・達成と予約200件の旅行の一覧が1秒以内に返る", async () => {
    const tripId = await createTrip(hinataCookie);
    const planId = await createPlan(hinataCookie, tripId, {
      name: "清水寺",
      kind: "place",
      date: "2026-09-11",
    });
    // 支払い200件・達成と予約200件をまとめて入れる
    await db.admin.query(
      `INSERT INTO record.payments (trip_id, amount_yen, payer_slot, slot0_percent,
         slot0_burden_yen, slot1_burden_yen, contribution_yen, created_by, created_at)
       SELECT $1, 7001, 0, 50, 3501, 3500, 3500, $2,
              '2026-09-01T00:00:00Z'::timestamptz + (g || ' seconds')::interval
         FROM generate_series(1, 200) g`,
      [tripId, hinata.userId],
    );
    await db.admin.query(
      `INSERT INTO record.plan_events (trip_id, plan_id, event_kind, created_by, created_at)
       SELECT $1, $2, CASE WHEN g % 2 = 0 THEN 'achievement' ELSE 'booking' END,
              $3, '2026-09-01T00:00:00Z'::timestamptz + (g || ' seconds')::interval
         FROM generate_series(1, 200) g`,
      [tripId, planId, hinata.userId],
    );

    const started = performance.now();
    const response = await listRecords(hinataCookie, tripId, "?limit=100");
    const elapsed = performance.now() - started;

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(100);
    expect(response.body.nextCursor).not.toBeNull();
    expect(elapsed).toBeLessThan(1000);
  });
});
