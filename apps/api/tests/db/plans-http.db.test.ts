import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import type { Auth } from "better-auth";
import type { TestHelpers } from "better-auth/plugins";
import { testUtils } from "better-auth/plugins";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLOCK } from "../../src/adapter/clock/clock";
import { AppModule } from "../../src/app.module";
import { LocalDate } from "../../src/common/domain/local-date";
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
let aoiCookie: string;

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

async function planCount(tripId: string): Promise<number> {
  const result = await db.admin.query<{ c: string }>(
    "SELECT count(*)::text AS c FROM planning.plans WHERE trip_id = $1",
    [tripId],
  );
  return Number(result.rows[0]!.c);
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

async function postPlan(
  cookie: string,
  tripId: string,
  body: unknown,
  key = newKey(),
): Promise<request.Response> {
  return authed(http().post(`/api/trips/${tripId}/plans`), cookie)
    .set("Idempotency-Key", key)
    .send(body);
}

async function createPlan(
  cookie: string,
  tripId: string,
  body: Record<string, unknown>,
  key = newKey(),
): Promise<{ id: string; etag: string }> {
  const response = await postPlan(cookie, tripId, body, key);
  expect(response.status).toBe(201);
  return { id: response.body.id as string, etag: response.headers.etag };
}

async function patchPlan(
  cookie: string,
  tripId: string,
  planId: string,
  body: unknown,
  ifMatch = '"1"',
  key = newKey(),
): Promise<request.Response> {
  return authed(http().patch(`/api/trips/${tripId}/plans/${planId}`), cookie)
    .set("Idempotency-Key", key)
    .set("If-Match", ifMatch)
    .send(body);
}

async function movePlan(
  cookie: string,
  tripId: string,
  planId: string,
  date: string,
  ifMatch: string,
  key = newKey(),
): Promise<request.Response> {
  return authed(
    http().post(`/api/trips/${tripId}/plans/${planId}/move`),
    cookie,
  )
    .set("Idempotency-Key", key)
    .set("If-Match", ifMatch)
    .send({ date });
}

async function cancelPlan(
  cookie: string,
  tripId: string,
  planId: string,
  ifMatch: string,
  key = newKey(),
): Promise<request.Response> {
  return authed(
    http().post(`/api/trips/${tripId}/plans/${planId}/cancel`),
    cookie,
  )
    .set("Idempotency-Key", key)
    .set("If-Match", ifMatch);
}

/** ひなたが参加しない旅行を別利用者 2 人で直接作る。 */
async function seedForeignTrip(): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const u0 = await insertUser(`foreign-${suffix}-0`, `foreign-${suffix}-0@example.test`);
  const u1 = await insertUser(`foreign-${suffix}-1`, `foreign-${suffix}-1@example.test`);
  const result = await db.admin.query<{ id: string }>(
    "INSERT INTO planning.trips (name, starts_on, ends_on, created_by) VALUES ('関係ない旅行', '2026-10-01', '2026-10-02', $1) RETURNING id",
    [u0],
  );
  const tripId = result.rows[0]!.id;
  await db.admin.query(
    "INSERT INTO planning.trip_participants (trip_id, slot, user_id) VALUES ($1, 0, $2), ($1, 1, $3)",
    [tripId, u0, u1],
  );
  return tripId;
}

/** record の履歴行を直接作る（M4 の記録 API は未実装のため）。 */
async function seedRecordEvent(
  tripId: string,
  planId: string,
  eventKind: "achievement" | "booking",
  createdBy: string,
  options: { active?: boolean; cancelledBy?: string } = {},
): Promise<string> {
  const inserted = await db.admin.query<{ id: string }>(
    "INSERT INTO record.plan_events (trip_id, plan_id, event_kind, created_by) VALUES ($1, $2, $3, $4) RETURNING id",
    [tripId, planId, eventKind, createdBy],
  );
  const eventId = inserted.rows[0]!.id;
  if (options.active === true) {
    await db.admin.query(
      "INSERT INTO record.active_plan_events (trip_id, plan_id, event_kind, event_id) VALUES ($1, $2, $3, $4)",
      [tripId, planId, eventKind, eventId],
    );
  }
  if (options.cancelledBy !== undefined) {
    await db.admin.query(
      "INSERT INTO record.plan_event_cancellations (event_id, trip_id, cancelled_by) VALUES ($1, $2, $3)",
      [eventId, tripId, options.cancelledBy],
    );
  }
  return eventId;
}

/**
 * 予定行のロックで待っている別接続が現れるまで pg_stat_activity を見る
 * （時間待ちにしない。R-3）。FOR NO KEY UPDATE の待ちは tuple ではなく
 * transactionid の待ちイベントとして現れる。app_runtime の
 * statement_timeout は 5s なので、待ちを検出したら速やかに COMMIT する。
 */
async function waitForPlanLockWaiter(timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await db.admin.query<{ c: string }>(
      `SELECT count(*)::text AS c
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND wait_event IN ('transactionid', 'tuple')
          AND query LIKE '%for no key update%'`,
    );
    if (Number(result.rows[0]!.c) > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for the plan row lock waiter");
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
  aoiCookie = await login(aoi.userId);
}, 120_000);

afterAll(async () => {
  await app?.close();
  await closePool();
  await db?.stop();
  for (const key of Object.keys(AUTH_ENV)) {
    delete process.env[key];
  }
});

describe("予定の追加（P-01〜P-02）", () => {
  it("P-01: 時刻なしで 201・ETag・DTO 全項目、しおりにも出る", async () => {
    const tripId = await createTrip(hinataCookie);
    const response = await postPlan(hinataCookie, tripId, {
      name: "清水寺",
      kind: "place",
      date: "2026-09-11",
      memo: "  拝観料 500 円  ",
    });

    expect(response.status).toBe(201);
    expect(response.headers.etag).toBe('"1"');
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toMatchObject({
      tripId,
      name: "清水寺",
      kind: "place",
      date: "2026-09-11",
      time: null,
      memo: "拝観料 500 円",
      cancelledAt: null,
      cancelledBy: null,
      version: "1",
      achievement: null,
      booking: null,
      canChangeKind: true,
      kindChangeReason: null,
    });
    const planId = response.body.id as string;

    const itinerary = await authed(
      http().get(`/api/trips/${tripId}/itinerary?date=2026-09-11`),
      hinataCookie,
    );
    expect(itinerary.status).toBe(200);
    expect(itinerary.headers["cache-control"]).toBe("private, no-store");
    expect(itinerary.body.date).toBe("2026-09-11");
    expect(itinerary.body.trip.id).toBe(tripId);
    expect(
      (itinerary.body.plans as { id: string }[]).map((plan) => plan.id),
    ).toEqual([planId]);

    const receipts = await db.admin.query(
      "SELECT operation, http_status, resource_type, resource_id FROM infra.command_receipts WHERE resource_id = $1",
      [planId],
    );
    expect(receipts.rows).toEqual([
      {
        operation: "createPlan",
        http_status: 201,
        resource_type: "plan",
        resource_id: planId,
      },
    ]);
  });

  it("P-02: 期間の両端は成功・外は 422 で行が増えない。空白名は 422、秒つき時刻は 400", async () => {
    const tripId = await createTrip(hinataCookie, {
      name: "期間のテスト",
      startsOn: "2026-09-01",
      endsOn: "2026-09-03",
    });
    const base = { name: "予定", kind: "place" };

    for (const date of ["2026-09-01", "2026-09-03"]) {
      const response = await postPlan(hinataCookie, tripId, { ...base, date });
      expect(response.status).toBe(201);
    }
    for (const date of ["2026-08-31", "2026-09-04"]) {
      const response = await postPlan(hinataCookie, tripId, { ...base, date });
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ code: "PLAN_OUTSIDE_TRIP_PERIOD" });
    }
    expect(await planCount(tripId)).toBe(2);

    const blankName = await postPlan(hinataCookie, tripId, {
      ...base,
      date: "2026-09-01",
      name: "   ",
    });
    expect(blankName.status).toBe(422);
    expect(blankName.body).toMatchObject({ code: "VALIDATION_FAILED" });

    const secondsTime = await postPlan(hinataCookie, tripId, {
      ...base,
      date: "2026-09-01",
      time: "10:00:00",
    });
    expect(secondsTime.status).toBe(400);
    expect(secondsTime.body).toMatchObject({ code: "INVALID_REQUEST" });
  });
});

describe("取得としおり（P-03、P-10〜P-12）", () => {
  it("P-03: 別の旅行の予定・存在しない予定は同じ 404、参加しない旅行は 403", async () => {
    const tripA = await createTrip(hinataCookie);
    const tripB = await createTrip(hinataCookie, { name: "別の旅行" });
    const { id: planA } = await createPlan(hinataCookie, tripA, {
      name: "清水寺",
      kind: "place",
      date: "2026-09-11",
    });

    const ok = await authed(
      http().get(`/api/trips/${tripA}/plans/${planA}`),
      hinataCookie,
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.etag).toBe('"1"');
    expect(ok.body).toMatchObject({ id: planA, canChangeKind: true });

    const otherTrip = await authed(
      http().get(`/api/trips/${tripB}/plans/${planA}`),
      hinataCookie,
    );
    const missing = await authed(
      http().get(`/api/trips/${tripB}/plans/${crypto.randomUUID()}`),
      hinataCookie,
    );
    for (const response of [otherTrip, missing]) {
      expect(response.status).toBe(404);
      expect(response.body.code).toBe("PLAN_NOT_FOUND");
    }
    // 別の旅行の予定と存在しない予定で本文が同じ（requestId は要求ごとに違う）
    const { requestId: _o, ...otherBody } = otherTrip.body;
    const { requestId: _m, ...missingBody } = missing.body;
    expect(otherBody).toEqual(missingBody);

    const foreignTripId = await seedForeignTrip();
    const foreignGet = await authed(
      http().get(`/api/trips/${foreignTripId}/plans/${planA}`),
      hinataCookie,
    );
    const foreignPost = await postPlan(hinataCookie, foreignTripId, {
      name: "x",
      kind: "place",
      date: "2026-10-01",
    });
    const foreignItinerary = await authed(
      http().get(`/api/trips/${foreignTripId}/itinerary`),
      hinataCookie,
    );
    const missingTrip = await authed(
      http().get(`/api/trips/${crypto.randomUUID()}/plans/${planA}`),
      hinataCookie,
    );
    for (const response of [foreignGet, foreignPost, foreignItinerary, missingTrip]) {
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("TRIP_NOT_ACCESSIBLE");
    }
  });

  it("P-10: 時刻順・未定は末尾・同時刻は登録順・取りやめ済みも含む", async () => {
    const tripId = await createTrip(hinataCookie);
    const day = "2026-09-11";
    const noon = await createPlan(hinataCookie, tripId, {
      name: "昼食",
      kind: "food",
      date: day,
      time: "12:00",
    });
    const morning = await createPlan(hinataCookie, tripId, {
      name: "清水寺",
      kind: "place",
      date: day,
      time: "09:00",
    });
    const undecided = await createPlan(hinataCookie, tripId, {
      name: "未定の予定",
      kind: "shopping",
      date: day,
    });
    const cancelled = await createPlan(hinataCookie, tripId, {
      name: "取りやめた早朝",
      kind: "place",
      date: day,
      time: "07:00",
    });
    const otherDay = await createPlan(hinataCookie, tripId, {
      name: "別の日の予定",
      kind: "place",
      date: "2026-09-12",
      time: "06:00",
    });
    await cancelPlan(hinataCookie, tripId, cancelled.id, '"1"');

    const itinerary = await authed(
      http().get(`/api/trips/${tripId}/itinerary?date=${day}`),
      hinataCookie,
    );
    expect(itinerary.status).toBe(200);
    const plans = itinerary.body.plans as {
      id: string;
      cancelledAt: string | null;
    }[];
    expect(plans.map((plan) => plan.id)).toEqual([
      cancelled.id,
      morning.id,
      noon.id,
      undecided.id,
    ]);
    expect(plans.map((plan) => plan.id)).not.toContain(otherDay.id);
    expect(plans[0]!.cancelledAt).not.toBeNull();
  });

  it("P-11: 期間外の日付は 422、実在しない日付は 422。省略は固定 Clock の規則", async () => {
    const tripId = await createTrip(hinataCookie);

    for (const date of ["2026-09-09", "2026-09-13"]) {
      const outside = await authed(
        http().get(`/api/trips/${tripId}/itinerary?date=${date}`),
        hinataCookie,
      );
      expect(outside.status).toBe(422);
      expect(outside.body).toMatchObject({ code: "PLAN_OUTSIDE_TRIP_PERIOD" });
    }
    const unreal = await authed(
      http().get(`/api/trips/${tripId}/itinerary?date=2026-02-30`),
      hinataCookie,
    );
    expect(unreal.status).toBe(422);
    expect(unreal.body).toMatchObject({ code: "VALIDATION_FAILED" });

    // Clock を固定したアプリで「省略時は期間内の今日 → 期間外なら初日」を確かめる
    for (const [today, expected] of [
      ["2026-09-11", "2026-09-11"],
      ["2026-09-05", "2026-09-10"],
      ["2026-09-20", "2026-09-10"],
    ] as const) {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(CLOCK)
        .useValue({
          now: () => new Date(`${today}T00:00:00.000Z`),
          today: () => LocalDate.parse(today),
        })
        .compile();
      const fixedApp = await createHttpTestApp(moduleRef, auth);
      try {
        const response = await authed(
          request(fixedApp.getHttpServer()).get(
            `/api/trips/${tripId}/itinerary`,
          ),
          hinataCookie,
        );
        expect(response.status).toBe(200);
        expect(response.body.date).toBe(expected);
      } finally {
        await fixedApp.close();
      }
    }
  });

  it("P-12: 有効な達成・予約を結合し、取り消し済みは null・履歴ありで canChangeKind=false", async () => {
    const tripId = await createTrip(hinataCookie);
    const { id: planId } = await createPlan(hinataCookie, tripId, {
      name: "昼食",
      kind: "food",
      date: "2026-09-11",
    });

    const eventId = await seedRecordEvent(
      tripId,
      planId,
      "achievement",
      hinata.userId,
      { active: true },
    );
    // 取り消し済みの予約（active には入れない）→ booking は null のまま
    await seedRecordEvent(tripId, planId, "booking", aoi.userId, {
      cancelledBy: aoi.userId,
    });

    const fetched = await authed(
      http().get(`/api/trips/${tripId}/plans/${planId}`),
      aoiCookie,
    );
    expect(fetched.status).toBe(200);
    expect(fetched.body.achievement).toMatchObject({
      id: eventId,
      tripId,
      planId,
      kind: "achievement",
      createdBy: hinata.userId,
      cancellation: null,
    });
    expect(fetched.body.booking).toBeNull();
    expect(fetched.body.canChangeKind).toBe(false);
    expect(fetched.body.kindChangeReason).toBe("record_history_exists");

    const itinerary = await authed(
      http().get(`/api/trips/${tripId}/itinerary?date=2026-09-11`),
      aoiCookie,
    );
    const inList = (itinerary.body.plans as { id: string }[]).find(
      (plan) => plan.id === planId,
    );
    expect(inList).toMatchObject({
      achievement: { id: eventId },
      booking: null,
      canChangeKind: false,
      kindChangeReason: "record_history_exists",
    });
  });
});

describe("更新・移動・取りやめ（P-04〜P-08）", () => {
  it("P-04: 部分更新は version が増え、同じ値は増えない。If-Match 必須", async () => {
    const tripId = await createTrip(hinataCookie);
    const { id: planId } = await createPlan(hinataCookie, tripId, {
      name: "清水寺",
      kind: "place",
      date: "2026-09-11",
      time: "09:00",
    });

    const noIfMatch = await authed(
      http().patch(`/api/trips/${tripId}/plans/${planId}`),
      hinataCookie,
    )
      .set("Idempotency-Key", newKey())
      .send({ name: "別名" });
    expect(noIfMatch.status).toBe(428);
    expect(noIfMatch.body).toMatchObject({ code: "IF_MATCH_REQUIRED" });

    const renamed = await patchPlan(hinataCookie, tripId, planId, {
      name: "銀閣寺",
      time: null,
      memo: "メモ",
    });
    expect(renamed.status).toBe(200);
    expect(renamed.headers.etag).toBe('"2"');
    expect(renamed.body).toMatchObject({
      name: "銀閣寺",
      time: null,
      memo: "メモ",
      version: "2",
      date: "2026-09-11",
    });

    // 同じ値を送っても 200 だが version は増えない
    const same = await patchPlan(
      hinataCookie,
      tripId,
      planId,
      { name: "銀閣寺", time: null, memo: "メモ" },
      '"2"',
    );
    expect(same.status).toBe(200);
    expect(same.body.version).toBe("2");
    expect(same.headers.etag).toBe('"2"');

    // 空の patch は 400
    const empty = await patchPlan(hinataCookie, tripId, planId, {}, '"2"');
    expect(empty.status).toBe(400);

    const current = await authed(
      http().get(`/api/trips/${tripId}/plans/${planId}`),
      hinataCookie,
    );
    expect(current.body.version).toBe("2");
  });

  it("P-05: 履歴（取り消し済みを含む）があると種類変更は 409 で他の項目も変わらない", async () => {
    const tripId = await createTrip(hinataCookie);
    const { id: planId } = await createPlan(hinataCookie, tripId, {
      name: "昼食",
      kind: "food",
      date: "2026-09-11",
      memo: "取り置き",
    });
    await seedRecordEvent(tripId, planId, "booking", hinata.userId, {
      cancelledBy: hinata.userId,
    });

    const response = await patchPlan(hinataCookie, tripId, planId, {
      kind: "place",
      name: "変えてしまう名前",
      memo: "変えてしまうメモ",
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "PLAN_HAS_RECORD_HISTORY" });

    const current = await authed(
      http().get(`/api/trips/${tripId}/plans/${planId}`),
      hinataCookie,
    );
    expect(current.body).toMatchObject({
      name: "昼食",
      kind: "food",
      memo: "取り置き",
      version: "1",
      canChangeKind: false,
      kindChangeReason: "record_history_exists",
    });
  });

  it("P-06: 履歴が無ければ種類を変えられる", async () => {
    const tripId = await createTrip(hinataCookie);
    const { id: planId } = await createPlan(hinataCookie, tripId, {
      name: "昼食",
      kind: "food",
      date: "2026-09-11",
    });

    const response = await patchPlan(hinataCookie, tripId, planId, {
      kind: "place",
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ kind: "place", version: "2" });
  });

  it("P-07: 期間内への移動は version が増え、期間外は 422 で日付は変わらない", async () => {
    const tripId = await createTrip(hinataCookie);
    const { id: planId } = await createPlan(hinataCookie, tripId, {
      name: "清水寺",
      kind: "place",
      date: "2026-09-11",
    });

    const moved = await movePlan(
      hinataCookie,
      tripId,
      planId,
      "2026-09-10",
      '"1"',
    );
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ date: "2026-09-10", version: "2" });
    expect(moved.headers.etag).toBe('"2"');

    const outside = await movePlan(
      hinataCookie,
      tripId,
      planId,
      "2026-09-15",
      '"2"',
    );
    expect(outside.status).toBe(422);
    expect(outside.body).toMatchObject({ code: "PLAN_OUTSIDE_TRIP_PERIOD" });

    const current = await authed(
      http().get(`/api/trips/${tripId}/plans/${planId}`),
      hinataCookie,
    );
    expect(current.body).toMatchObject({ date: "2026-09-10", version: "2" });
  });

  it("P-08: 取りやめは一度だけ。2 回目は 409。取りやめ後の編集は取りやめのまま", async () => {
    const tripId = await createTrip(hinataCookie);
    const { id: planId } = await createPlan(hinataCookie, tripId, {
      name: "清水寺",
      kind: "place",
      date: "2026-09-11",
    });

    const cancelled = await cancelPlan(hinataCookie, tripId, planId, '"1"');
    expect(cancelled.status).toBe(200);
    expect(cancelled.headers.etag).toBe('"2"');
    expect(cancelled.body).toMatchObject({
      cancelledBy: hinata.userId,
      version: "2",
    });
    expect(cancelled.body.cancelledAt).not.toBeNull();

    const again = await cancelPlan(
      aoiCookie,
      tripId,
      planId,
      '"2"',
      newKey(),
    );
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: "PLAN_CANCELLED" });

    const edited = await patchPlan(
      hinataCookie,
      tripId,
      planId,
      { memo: "来年こそ" },
      '"2"',
    );
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({
      memo: "来年こそ",
      version: "3",
      cancelledBy: hinata.userId,
    });
    expect(edited.body.cancelledAt).toBe(cancelled.body.cancelledAt);

    // 取りやめ済みもしおりに残る
    const itinerary = await authed(
      http().get(`/api/trips/${tripId}/itinerary?date=2026-09-11`),
      hinataCookie,
    );
    const inList = (itinerary.body.plans as { id: string }[]).map(
      (plan) => plan.id,
    );
    expect(inList).toEqual([planId]);
  });

  it("P-09: 追加の同じキー再送は、相手が名前を変えたあとでも追加時点の DTO・ETag を返す", async () => {
    const tripId = await createTrip(hinataCookie);
    const key = newKey();
    const created = await postPlan(hinataCookie, tripId, {
      name: "清水寺",
      kind: "place",
      date: "2026-09-11",
    }, key);
    expect(created.status).toBe(201);
    const planId = created.body.id as string;

    await patchPlan(aoiCookie, tripId, planId, { name: "あおいの改名" }, '"1"');

    const replay = await postPlan(hinataCookie, tripId, {
      name: "清水寺",
      kind: "place",
      date: "2026-09-11",
    }, key);
    expect(replay.status).toBe(201);
    expect(replay.headers.etag).toBe('"1"');
    expect(replay.body).toEqual(created.body);

    const current = await authed(
      http().get(`/api/trips/${tripId}/plans/${planId}`),
      hinataCookie,
    );
    expect(current.body).toMatchObject({ name: "あおいの改名", version: "2" });
  });
});

describe("同時実行（P-13〜P-15）", () => {
  it("P-13: 期間の縮小と期間外への予定追加はどちらか一方だけが成立する（E-18）", async () => {
    const tripId = await createTrip(hinataCookie, {
      name: "競合の旅行",
      startsOn: "2026-09-01",
      endsOn: "2026-09-03",
    });

    const [shrink, created] = await Promise.all([
      authed(http().put(`/api/trips/${tripId}/period`), hinataCookie)
        .set("Idempotency-Key", newKey())
        .set("If-Match", '"1"')
        .send({ startsOn: "2026-09-01", endsOn: "2026-09-02" }),
      postPlan(hinataCookie, tripId, {
        name: "ぎりぎりの予定",
        kind: "place",
        date: "2026-09-03",
      }),
    ]);

    const succeeded = [shrink, created].filter((r) => r.status < 300);
    const rejected = [shrink, created].filter((r) => r.status === 422);
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.body).toMatchObject({
      code: "PLAN_OUTSIDE_TRIP_PERIOD",
    });

    const trip = await db.admin.query<{ ends_on: string }>(
      "SELECT ends_on::text AS ends_on FROM planning.trips WHERE id = $1",
      [tripId],
    );
    const onTheDay = await db.admin.query<{ c: string }>(
      "SELECT count(*)::text AS c FROM planning.plans WHERE trip_id = $1 AND planned_date = '2026-09-03'",
      [tripId],
    );
    if (shrink.status === 200) {
      // 期間が先に縮んだ: 9/3 の予定は作られていない
      expect(trip.rows[0]!.ends_on).toBe("2026-09-02");
      expect(onTheDay.rows[0]!.c).toBe("0");
    } else {
      // 予定が先に入った: 期間は 9/3 を含んだまま
      expect(trip.rows[0]!.ends_on).toBe("2026-09-03");
      expect(onTheDay.rows[0]!.c).toBe("1");
    }
  });

  it("P-14: 予定行ロック中に履歴が COMMIT されると、種類変更は待って PLAN_HAS_RECORD_HISTORY になる（E-19）", async () => {
    const tripId = await createTrip(hinataCookie);
    const { id: planId } = await createPlan(hinataCookie, tripId, {
      name: "昼食",
      kind: "food",
      date: "2026-09-11",
    });

    // 接続 A: 予定行を FOR NO KEY UPDATE で持ったまま履歴を入れる（未 COMMIT）
    const holder = await db.admin.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(
        "SELECT id FROM planning.plans WHERE id = $1 FOR NO KEY UPDATE",
        [planId],
      );
      const event = await holder.query<{ id: string }>(
        "INSERT INTO record.plan_events (trip_id, plan_id, event_kind, created_by) VALUES ($1, $2, 'achievement', $3) RETURNING id",
        [tripId, planId, hinata.userId],
      );
      await holder.query(
        "INSERT INTO record.active_plan_events (trip_id, plan_id, event_kind, event_id) VALUES ($1, $2, 'achievement', $3)",
        [tripId, planId, event.rows[0]!.id],
      );

      // 接続 B（API）: 種類の PATCH は予定行のロックで待つ
      const patchPromise = patchPlan(hinataCookie, tripId, planId, {
        kind: "place",
      });
      await waitForPlanLockWaiter();
      await holder.query("COMMIT");

      const patch = await patchPromise;
      expect(patch.status).toBe(409);
      expect(patch.body).toMatchObject({ code: "PLAN_HAS_RECORD_HISTORY" });

      const current = await authed(
        http().get(`/api/trips/${tripId}/plans/${planId}`),
        hinataCookie,
      );
      expect(current.body).toMatchObject({ kind: "food", version: "1" });
    } finally {
      holder.release();
    }
  });

  it("P-15: 同じ予定の同時更新（同じ If-Match・別キー）は片方だけ 200", async () => {
    const tripId = await createTrip(hinataCookie);
    const { id: planId } = await createPlan(hinataCookie, tripId, {
      name: "清水寺",
      kind: "place",
      date: "2026-09-11",
    });

    const [first, second] = await Promise.all([
      patchPlan(hinataCookie, tripId, planId, { name: "ひなたの名前" }),
      patchPlan(aoiCookie, tripId, planId, { name: "あおいの名前" }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    const conflicted = [first, second].find((r) => r.status === 409);
    expect(conflicted!.body).toMatchObject({ code: "VERSION_CONFLICT" });

    const current = await authed(
      http().get(`/api/trips/${tripId}/plans/${planId}`),
      hinataCookie,
    );
    expect(current.body.version).toBe("2");
  });
});
