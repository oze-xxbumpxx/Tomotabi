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
): Promise<string> {
  const response = await postPlan(cookie, tripId, body);
  expect(response.status).toBe(201);
  return response.body.id as string;
}

function paymentBody(overrides: Record<string, unknown> = {}) {
  return {
    amountYen: "7001",
    payerUserId: hinata.userId,
    allocations: [
      { userId: hinata.userId, percent: 50 },
      { userId: aoi.userId, percent: 50 },
    ],
    ...overrides,
  };
}

async function postPayment(
  cookie: string,
  tripId: string,
  body: unknown,
  key = newKey(),
): Promise<request.Response> {
  return authed(http().post(`/api/trips/${tripId}/payments`), cookie)
    .set("Idempotency-Key", key)
    .send(body);
}

async function createPayment(
  cookie: string,
  tripId: string,
  overrides: Record<string, unknown> = {},
  key = newKey(),
): Promise<request.Response> {
  const response = await postPayment(cookie, tripId, paymentBody(overrides), key);
  expect(response.status).toBe(201);
  return response;
}

async function cancelPayment(
  cookie: string,
  tripId: string,
  paymentId: string,
  key = newKey(),
): Promise<request.Response> {
  return authed(
    http().post(`/api/trips/${tripId}/payments/${paymentId}/cancel`),
    cookie,
  ).set("Idempotency-Key", key);
}

async function getPayment(
  cookie: string,
  tripId: string,
  paymentId: string,
): Promise<request.Response> {
  return authed(http().get(`/api/trips/${tripId}/payments/${paymentId}`), cookie);
}

async function paymentCount(tripId: string): Promise<number> {
  const result = await db.admin.query<{ c: string }>(
    "SELECT count(*)::text AS c FROM record.payments WHERE trip_id = $1",
    [tripId],
  );
  return Number(result.rows[0]!.c);
}

/** ひなたが参加しない旅行を別利用者2人で直接作り、支払いも1件入れる。 */
async function seedForeignTripWithPayment(): Promise<{
  tripId: string;
  paymentId: string;
}> {
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
  const payment = await db.admin.query<{ id: string }>(
    `INSERT INTO record.payments (trip_id, amount_yen, payer_slot, slot0_percent,
       slot0_burden_yen, slot1_burden_yen, contribution_yen, created_by)
     VALUES ($1, 7001, 0, 50, 3501, 3500, 3500, $2) RETURNING id`,
    [tripId, u0],
  );
  return { tripId, paymentId: payment.rows[0]!.id };
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

describe("支払いの記録（FH-01）", () => {
  it("7,001 円・折半・用途・関連する予定で 201。負担額 3,501 / 3,500・寄与・取消なし", async () => {
    const tripId = await createTrip(hinataCookie);
    const planId = await createPlan(hinataCookie, tripId, {
      name: "清水寺",
      kind: "place",
      date: "2026-09-11",
    });

    const response = await createPayment(hinataCookie, tripId, {
      label: "宿泊費",
      planId,
    });
    expect(response.status).toBe(201);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toMatchObject({
      tripId,
      planId,
      label: "宿泊費",
      amountYen: "7001",
      payerUserId: hinata.userId,
      allocations: [
        { userId: hinata.userId, percent: 50, burdenYen: "3501" },
        { userId: aoi.userId, percent: 50, burdenYen: "3500" },
      ],
      createdBy: hinata.userId,
      cancellation: null,
    });
    const paymentId = response.body.id as string;

    const row = await db.admin.query<{ contribution_yen: string }>(
      "SELECT contribution_yen::text AS contribution_yen FROM record.payments WHERE id = $1",
      [paymentId],
    );
    // 払った人は参加者番号0（ひなた）。寄与は1 → 0向きに正。
    expect(row.rows[0]!.contribution_yen).toBe("3500");

    const receipts = await db.admin.query(
      "SELECT operation, http_status, resource_type, resource_id FROM infra.command_receipts WHERE resource_id = $1",
      [paymentId],
    );
    expect(receipts.rows).toEqual([
      {
        operation: "createPayment",
        http_status: 201,
        resource_type: "payment",
        resource_id: paymentId,
      },
    ]);

    // 相手が払った場合は寄与の向きが変わる
    const byAoi = await createPayment(hinataCookie, tripId, {
      payerUserId: aoi.userId,
    });
    expect(byAoi.body.allocations).toEqual([
      { userId: hinata.userId, percent: 50, burdenYen: "3500" },
      { userId: aoi.userId, percent: 50, burdenYen: "3501" },
    ]);
    const rowAoi = await db.admin.query<{ contribution_yen: string }>(
      "SELECT contribution_yen::text AS contribution_yen FROM record.payments WHERE id = $1",
      [byAoi.body.id],
    );
    expect(rowAoi.rows[0]!.contribution_yen).toBe("-3500");

    // GETは取り消し状態を含めて同じ形で返す
    const fetched = await getPayment(hinataCookie, tripId, paymentId);
    expect(fetched.status).toBe(200);
    expect(fetched.headers["cache-control"]).toBe("private, no-store");
    expect(fetched.body).toEqual(response.body);
  });
});

describe("入力の拒否（FH-02）", () => {
  it("金額の形式・割合・用途・別の旅行の予定は 400 または 422。何も残らない", async () => {
    const tripId = await createTrip(hinataCookie);
    const otherTrip = await createTrip(hinataCookie, { name: "大阪" });
    const foreignPlanId = await createPlan(hinataCookie, otherTrip, {
      name: "海遊館",
      kind: "place",
      date: "2026-09-11",
    });
    const outsider = await insertUser("外部", "outsider@example.test");

    const cases: { body: unknown; want: number[] }[] = [
      { body: paymentBody({ amountYen: "0" }), want: [400] },
      { body: paymentBody({ amountYen: "abc" }), want: [400] },
      { body: paymentBody({ amountYen: "10000000" }), want: [400] },
      { body: paymentBody({ amountYen: "-100" }), want: [400] },
      {
        body: paymentBody({
          allocations: [
            { userId: hinata.userId, percent: 101 },
            { userId: aoi.userId, percent: -1 },
          ],
        }),
        want: [422],
      },
      {
        body: paymentBody({
          allocations: [
            { userId: hinata.userId, percent: 60 },
            { userId: aoi.userId, percent: 50 },
          ],
        }),
        want: [422],
      },
      {
        body: paymentBody({
          allocations: [
            { userId: hinata.userId, percent: 50 },
            { userId: hinata.userId, percent: 50 },
          ],
        }),
        want: [422],
      },
      {
        body: paymentBody({
          allocations: [
            { userId: hinata.userId, percent: 50 },
            { userId: outsider, percent: 50 },
          ],
        }),
        want: [422],
      },
      {
        body: paymentBody({ payerUserId: outsider }),
        want: [422],
      },
      { body: paymentBody({ label: "あ".repeat(101) }), want: [422] },
      { body: paymentBody({ label: "   " }), want: [422] },
      { body: paymentBody({ planId: foreignPlanId }), want: [422] },
    ];

    for (const { body, want } of cases) {
      const response = await postPayment(hinataCookie, tripId, body);
      expect(want).toContain(response.status);
      expect(response.body.code).toMatch(/INVALID_REQUEST|VALIDATION_FAILED/);
    }
    expect(await paymentCount(tripId)).toBe(0);
  });
});

describe("支払いの取り消し（FH-03）", () => {
  it("取り消しは 201。別のキーでもう一度は 200 で既存の取り消し。GET でも取消が出る", async () => {
    const tripId = await createTrip(hinataCookie);
    const created = await createPayment(hinataCookie, tripId);
    const paymentId = created.body.id as string;

    const cancelled = await cancelPayment(hinataCookie, tripId, paymentId);
    expect(cancelled.status).toBe(201);
    expect(cancelled.body).toMatchObject({
      targetId: paymentId,
      cancelledBy: hinata.userId,
    });
    expect(cancelled.body.createdAt).not.toBeNull();

    const again = await cancelPayment(aoiCookie, tripId, paymentId, newKey());
    expect(again.status).toBe(200);
    expect(again.body).toEqual(cancelled.body);

    const rows = await db.admin.query<{ c: string }>(
      "SELECT count(*)::text AS c FROM record.payment_cancellations WHERE payment_id = $1",
      [paymentId],
    );
    expect(rows.rows[0]!.c).toBe("1");

    const fetched = await getPayment(aoiCookie, tripId, paymentId);
    expect(fetched.status).toBe(200);
    expect(fetched.body.cancellation).toEqual(cancelled.body);
    // 元の支払いの行は変わらない
    expect(fetched.body).toMatchObject({
      id: paymentId,
      amountYen: "7001",
      payerUserId: hinata.userId,
    });
  });
});

describe("応答が消えたあとの再送（FH-15）", () => {
  it("同じキーの再送は元の結果を返し、違う本文は 409。app_runtime の接続で通る", async () => {
    const tripId = await createTrip(hinataCookie);
    const key = newKey();
    const body = paymentBody({ label: "再送の支払い" });

    const created = await postPayment(hinataCookie, tripId, body, key);
    expect(created.status).toBe(201);
    const paymentId = created.body.id as string;

    // 同じキー・同じ本文の再送は元の結果（二重に作られない）
    const replay = await postPayment(hinataCookie, tripId, body, key);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(created.body);
    expect(await paymentCount(tripId)).toBe(1);

    // 同じキー・違う本文は409
    const conflict = await postPayment(hinataCookie, tripId, {
      ...body,
      label: "別の内容",
    }, key);
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(await paymentCount(tripId)).toBe(1);

    // 取り消しも同じく: 同じキーの再送は元の201、別キーは200で既存
    const cancelKey = newKey();
    const cancelled = await cancelPayment(hinataCookie, tripId, paymentId, cancelKey);
    expect(cancelled.status).toBe(201);
    const replayCancel = await cancelPayment(hinataCookie, tripId, paymentId, cancelKey);
    expect(replayCancel.status).toBe(201);
    expect(replayCancel.body).toEqual(cancelled.body);

    // poolForのpoolはdb.stop()がまとめて閉じる（ここでは閉じない）
    const runtime = db.poolFor("app_runtime");
    const visible = await runtime.query(
      "SELECT resource_type, http_status FROM infra.command_receipts WHERE resource_id = $1 ORDER BY resource_type",
      [paymentId],
    );
    expect(visible.rows).toEqual([
      { resource_type: "payment", http_status: 201 },
      { resource_type: "payment_cancellation", http_status: 201 },
    ]);
  });
});

describe("同時実行の整合（レビュー must 対応）", () => {
  it("順番待ちの札が 3 秒で取れなければ 503 TEMPORARILY_UNAVAILABLE・retryable=true", async () => {
    const tripId = await createTrip(hinataCookie);
    const locker = await db.admin.connect();
    try {
      await locker.query("BEGIN");
      await locker.query(
        "SELECT trip_id FROM infra.trip_finance_guards WHERE trip_id = $1 FOR UPDATE",
        [tripId],
      );

      const response = await postPayment(hinataCookie, tripId, paymentBody());
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        code: "TEMPORARILY_UNAVAILABLE",
        retryable: true,
      });
      expect(await paymentCount(tripId)).toBe(0);
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
    }
  }, 30_000);

  it("同じキーを別の旅行へ同時に送っても 500 でなく 409", async () => {
    const tripA = await createTrip(hinataCookie);
    const tripB = await createTrip(hinataCookie, { name: "別の旅行" });
    const key = newKey();

    // 負ける側の支払いのinsertを、trip_participantsへの参照整合
    // （KEY SHAREロック取得）で待たせるために、管理者が対象行を先に押さえる。
    // FOR UPDATEはKEY SHAREと競合する。
    const holder = await db.admin.connect();
    let loser: Promise<request.Response>;
    try {
      await holder.query("BEGIN");
      await holder.query(
        "SELECT trip_id, slot FROM planning.trip_participants WHERE trip_id = $1 FOR UPDATE",
        [tripB],
      );
      // 負ける側: 受領の照会は通り、支払いのinsertでブロックされる
      loser = postPayment(hinataCookie, tripB, paymentBody({ label: "負ける側" }), key);

      // 勝った側が先にCOMMITするのを待ってからブロックを解く
      const winner = await postPayment(hinataCookie, tripA, paymentBody({ label: "勝つ側" }), key);
      expect(winner.status).toBe(201);
    } finally {
      await holder.query("COMMIT");
      holder.release();
    }

    const response = await loser!;
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(await paymentCount(tripA)).toBe(1);
    expect(await paymentCount(tripB)).toBe(0);
  }, 30_000);
});

describe("認可（FH-16）", () => {
  it("参加しない・存在しない旅行は同じ 403。別の旅行の支払い・無い支払いは同じ 404", async () => {
    const tripId = await createTrip(hinataCookie);
    const created = await createPayment(hinataCookie, tripId);
    const paymentId = created.body.id as string;
    const foreign = await seedForeignTripWithPayment();
    const missingTrip = crypto.randomUUID();
    const missingPayment = crypto.randomUUID();

    // 参加しない旅行・存在しない旅行はどちらも同じ403（支払いの記録・取得・取り消し）
    for (const target of [foreign.tripId, missingTrip]) {
      const create = await postPayment(hinataCookie, target, paymentBody());
      expect(create.status).toBe(403);
      expect(create.body).toMatchObject({ code: "TRIP_NOT_ACCESSIBLE" });

      const get = await getPayment(hinataCookie, target, paymentId);
      expect(get.status).toBe(403);
      expect(get.body).toMatchObject({ code: "TRIP_NOT_ACCESSIBLE" });

      const cancel = await cancelPayment(hinataCookie, target, paymentId);
      expect(cancel.status).toBe(403);
      expect(cancel.body).toMatchObject({ code: "TRIP_NOT_ACCESSIBLE" });

      // 外国の旅行の支払いidでも403で404にしない（支払いの存在を漏らさない）
      const foreignGet = await getPayment(hinataCookie, target, foreign.paymentId);
      expect(foreignGet.status).toBe(403);
    }

    // 参加している旅行の中では、無い支払いと別の旅行の支払いは同じ404
    const missing = await getPayment(hinataCookie, tripId, missingPayment);
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: "PAYMENT_NOT_FOUND" });
    const foreignPayment = await getPayment(hinataCookie, tripId, foreign.paymentId);
    expect(foreignPayment.status).toBe(404);
    expect({ ...foreignPayment.body, requestId: null }).toEqual({
      ...missing.body,
      requestId: null,
    });

    const missingCancel = await cancelPayment(hinataCookie, tripId, missingPayment);
    expect(missingCancel.status).toBe(404);
    expect(missingCancel.body).toMatchObject({ code: "PAYMENT_NOT_FOUND" });
    const foreignCancel = await cancelPayment(hinataCookie, tripId, foreign.paymentId);
    expect(foreignCancel.status).toBe(404);
    expect({ ...foreignCancel.body, requestId: null }).toEqual({
      ...missingCancel.body,
      requestId: null,
    });

    // 別の旅行の予定を関連付けようとしても422（支払いは残らない）
    const otherTrip = await createTrip(hinataCookie, { name: "別の旅行" });
    const planElsewhere = await createPlan(hinataCookie, otherTrip, {
      name: "別の予定",
      kind: "place",
      date: "2026-09-11",
    });
    const crossed = await postPayment(hinataCookie, tripId, paymentBody({ planId: planElsewhere }));
    expect(crossed.status).toBe(422);
    expect(await paymentCount(tripId)).toBe(1);
  });
});

describe("エラーに中身を出さない（FH-17）", () => {
  it("各エラーの応答に金額・用途・SQL・パスワードが出ない", async () => {
    const tripId = await createTrip(hinataCookie);
    const marker = "機密用途ZXQ99";
    const markerAmount = "987654";

    const requests: Promise<request.Response>[] = [
      // 400（形式）・422（値）・403（認可）・404（不在）・409（キー使い回し）
      postPayment(hinataCookie, tripId, paymentBody({ amountYen: `1${markerAmount}3`, label: marker })),
      postPayment(hinataCookie, tripId, {
        amountYen: markerAmount,
        payerUserId: hinata.userId,
        allocations: [
          { userId: hinata.userId, percent: 99 },
          { userId: aoi.userId, percent: 99 },
        ],
        label: marker,
      }),
      postPayment(hinataCookie, crypto.randomUUID(), paymentBody({ amountYen: markerAmount, label: marker })),
      getPayment(hinataCookie, tripId, crypto.randomUUID()),
      (async () => {
        const key = newKey();
        const ok = await postPayment(hinataCookie, tripId, paymentBody({ label: marker }), key);
        expect(ok.status).toBe(201);
        return postPayment(hinataCookie, tripId, paymentBody({ label: marker, amountYen: markerAmount }), key);
      })(),
    ];
    const responses = await Promise.all(requests);
    const bodies = responses.map((r) => JSON.stringify(r.body));
    for (const body of bodies) {
      expect(body).not.toContain(marker);
      expect(body).not.toContain(markerAmount);
      expect(body.toLowerCase()).not.toContain("sql");
      expect(body).not.toContain("record.payments");
      expect(body).not.toContain("insert into");
      expect(body).not.toContain("SELECT");
      expect(body).not.toContain("password");
    }
    // エラーの種類が意図どおり出ていること（全部4xx/5xxのエラー応答）
    const statuses = responses.map((r) => r.status);
    expect(statuses).toEqual(expect.arrayContaining([400, 403, 404, 409, 422]));
  });
});
