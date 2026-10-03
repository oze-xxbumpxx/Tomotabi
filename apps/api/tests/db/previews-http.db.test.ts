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

/** 一覧カーソルの wire 形式（サーバー発行の形に合わせた base64url の JSON）。 */
function cursorOf(previewId: string): string {
  return Buffer.from(JSON.stringify({ i: previewId }), "utf8").toString(
    "base64url",
  );
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
): Promise<request.Response> {
  const response = await postPayment(cookie, tripId, paymentBody(overrides));
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

async function getBalance(
  cookie: string,
  tripId: string,
): Promise<request.Response> {
  return authed(http().get(`/api/trips/${tripId}/balance`), cookie);
}

async function postPreview(
  cookie: string,
  tripId: string,
  key = newKey(),
): Promise<request.Response> {
  return authed(http().post(`/api/trips/${tripId}/settlement-previews`), cookie)
    .set("Idempotency-Key", key);
}

async function createPreview(
  cookie: string,
  tripId: string,
): Promise<request.Response> {
  const response = await postPreview(cookie, tripId);
  expect(response.status).toBe(201);
  return response;
}

async function listPreviews(
  cookie: string,
  tripId: string,
  query = "",
): Promise<request.Response> {
  return authed(
    http().get(`/api/trips/${tripId}/settlement-previews${query}`),
    cookie,
  );
}

async function getPreview(
  cookie: string,
  tripId: string,
  previewId: string,
): Promise<request.Response> {
  return authed(
    http().get(`/api/trips/${tripId}/settlement-previews/${previewId}`),
    cookie,
  );
}

async function previewCount(tripId: string): Promise<number> {
  const result = await db.admin.query<{ c: string }>(
    "SELECT count(*)::text AS c FROM settlement.previews WHERE trip_id = $1",
    [tripId],
  );
  return Number(result.rows[0]!.c);
}

/**
 * 確認を精算済みにする（精算の完了 API はまだ無いので、管理者の接続から
 * 本番が書くのと同じ行を入れる: 精算 → 明細 → 占有）。confirmation の
 * preview_items をそのまま settlement.items に写す。
 */
async function adminSettlePreview(
  tripId: string,
  previewId: string,
  createdBy: string,
): Promise<string> {
  const settlement = await db.admin.query<{ id: string }>(
    `INSERT INTO settlement.settlements
       (trip_id, preview_id, sequence, signed_total_yen, completion_kind, created_by)
     SELECT trip_id, id,
            (SELECT coalesce(max(sequence), 0) + 1
               FROM settlement.settlements WHERE trip_id = $1),
            signed_total_yen,
            CASE WHEN signed_total_yen = 0
                 THEN 'no_transfer_required' ELSE 'transfer_completed' END,
            $3
       FROM settlement.previews WHERE trip_id = $1 AND id = $2
     RETURNING id`,
    [tripId, previewId, createdBy],
  );
  const settlementId = settlement.rows[0]!.id;
  await db.admin.query(
    `INSERT INTO settlement.items
       (settlement_id, trip_id, preview_id, payment_id, kind, contribution_yen, base_settlement_id, base_kind)
     SELECT $2, trip_id, preview_id, payment_id, kind, contribution_yen, base_settlement_id, base_kind
       FROM settlement.preview_items
      WHERE trip_id = $1 AND preview_id = $3`,
    [tripId, settlementId, previewId],
  );
  await db.admin.query(
    `INSERT INTO settlement.active_claims (trip_id, payment_id, kind, settlement_id)
     SELECT trip_id, payment_id, kind, settlement_id
       FROM settlement.items WHERE trip_id = $1 AND settlement_id = $2`,
    [tripId, settlementId],
  );
  return settlementId;
}

/**
 * 精算を取り消し済みにする（取り消しの記録を足し、占有を消す。
 * 本番の取り消しが書くのと同じ状態を管理者の接続から作る）。
 */
async function adminCancelSettlement(
  tripId: string,
  settlementId: string,
  cancelledBy: string,
): Promise<void> {
  await db.admin.query(
    `INSERT INTO settlement.cancellations (settlement_id, trip_id, cancelled_by)
     VALUES ($1, $2, $3)`,
    [settlementId, tripId, cancelledBy],
  );
  await db.admin.query(
    `DELETE FROM settlement.active_claims WHERE settlement_id = $1`,
    [settlementId],
  );
}

/** ひなたが参加しない旅行を別利用者 2 人で直接作る（guard の行も入れる）。 */
async function seedForeignTrip(): Promise<{ tripId: string }> {
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
  await db.admin.query(
    "INSERT INTO infra.trip_finance_guards (trip_id) VALUES ($1)",
    [tripId],
  );
  return { tripId };
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

describe("残額の取得（FH-04）", () => {
  it("払った人が違う支払い 2 件 → 向き・金額・件数・明細が合う", async () => {
    const tripId = await createTrip(hinataCookie);
    const first = await createPayment(hinataCookie, tripId, {
      amountYen: "7001",
      payerUserId: hinata.userId,
      label: "宿泊費",
    });
    const second = await createPayment(hinataCookie, tripId, {
      amountYen: "4001",
      payerUserId: aoi.userId,
      label: "夕食",
    });

    const response = await getBalance(hinataCookie, tripId);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body.tripId).toBe(tripId);
    expect(response.body.participants).toEqual([
      { userId: hinata.userId, slot: 0, displayName: "ひなた" },
      { userId: aoi.userId, slot: 1, displayName: "あおい" },
    ]);
    // 寄与 +3,500（ひなたの支払い）と −2,000（あおいの支払い）→ あおいが
    // ひなたに 1,500 円渡す向き。
    expect(response.body.transfer).toEqual({
      signedTotalYen: "1500",
      amountYen: "1500",
      fromUserId: aoi.userId,
      toUserId: hinata.userId,
      requiresTransfer: true,
    });
    expect(response.body.targetCount).toBe(2);
    expect(response.body.fetchedAt).not.toBeNull();
    expect(response.body.items).toHaveLength(2);
    expect(response.body.items[0]).toMatchObject({
      kind: "BASE",
      signedContributionYen: "3500",
      baseSettlementId: null,
      payment: {
        id: first.body.id,
        amountYen: "7001",
        payerUserId: hinata.userId,
        label: "宿泊費",
        cancellation: null,
      },
    });
    expect(response.body.items[1]).toMatchObject({
      kind: "BASE",
      signedContributionYen: "-2000",
      baseSettlementId: null,
      payment: {
        id: second.body.id,
        amountYen: "4001",
        payerUserId: aoi.userId,
        cancellation: null,
      },
    });
  });

  it("支払いが無ければ対象 0 件・0 円の残額（取り消し済みも含めて出さない）", async () => {
    const tripId = await createTrip(hinataCookie);
    const created = await createPayment(hinataCookie, tripId);
    // 支払いを取り消す → 精算されていないので対象からも消える
    await cancelPayment(hinataCookie, tripId, created.body.id);

    const response = await getBalance(aoiCookie, tripId);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      tripId,
      transfer: {
        signedTotalYen: "0",
        amountYen: "0",
        fromUserId: null,
        toUserId: null,
        requiresTransfer: false,
      },
      targetCount: 0,
      items: [],
    });
  });
});

describe("対象 0 件と 0 円（FH-05）", () => {
  it("対象なしで確認を作ると 422 NO_SETTLEMENT_TARGET で何も残らない", async () => {
    const tripId = await createTrip(hinataCookie);

    const response = await postPreview(hinataCookie, tripId);
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: "NO_SETTLEMENT_TARGET" });
    expect(await previewCount(tripId)).toBe(0);

    // 取り消し済みの支払いだけ（精算前）でも対象 0 件
    const created = await createPayment(hinataCookie, tripId);
    await cancelPayment(hinataCookie, tripId, created.body.id);
    const again = await postPreview(hinataCookie, tripId);
    expect(again.status).toBe(422);
    expect(await previewCount(tripId)).toBe(0);
  });

  it("合計 0 円の確認は作れる（transfer は 0 円の形）", async () => {
    const tripId = await createTrip(hinataCookie);
    await createPayment(hinataCookie, tripId, {
      amountYen: "7001",
      payerUserId: hinata.userId,
    });
    await createPayment(hinataCookie, tripId, {
      amountYen: "7001",
      payerUserId: aoi.userId,
    });

    const response = await postPreview(hinataCookie, tripId);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      tripId,
      createdBy: hinata.userId,
      transfer: {
        signedTotalYen: "0",
        amountYen: "0",
        fromUserId: null,
        toUserId: null,
        requiresTransfer: false,
      },
      validation: {
        status: "ready",
        cancelledPaymentIds: [],
        changedPaymentIds: [],
        existingSettlementId: null,
      },
    });
    expect(response.body.items).toHaveLength(2);
    expect(response.body.participants).toEqual([
      { userId: hinata.userId, slot: 0, displayName: "ひなた" },
      { userId: aoi.userId, slot: 1, displayName: "あおい" },
    ]);

    const receipt = await db.admin.query(
      `SELECT operation, resource_type, http_status, response_body
         FROM infra.command_receipts WHERE resource_id = $1`,
      [response.body.id],
    );
    expect(receipt.rows).toEqual([
      expect.objectContaining({
        operation: "createSettlementPreview",
        resource_type: "preview",
        http_status: 201,
      }),
    ]);
  });
});

describe("確認の固定（FH-06）", () => {
  it("確認を作ってから支払いを足しても、確認の明細・金額は変わらない", async () => {
    const tripId = await createTrip(hinataCookie);
    const first = await createPayment(hinataCookie, tripId, {
      amountYen: "7001",
      payerUserId: hinata.userId,
    });

    const created = await createPreview(hinataCookie, tripId);
    expect(created.body.items).toHaveLength(1);
    expect(created.body.transfer).toMatchObject({
      signedTotalYen: "3500",
      amountYen: "3500",
    });

    // あとから支払いを足す
    const second = await createPayment(hinataCookie, tripId, {
      amountYen: "4001",
      payerUserId: aoi.userId,
    });

    // 確認の取得: 固定した明細と金額は変わらない（F-21）
    const fetched = await getPreview(hinataCookie, tripId, created.body.id);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toEqual(created.body);
    expect(fetched.body.items[0].payment.id).toBe(first.body.id);
    expect(fetched.body.validation).toEqual({
      status: "ready",
      cancelledPaymentIds: [],
      changedPaymentIds: [],
      existingSettlementId: null,
    });

    // 足した支払いは残額にだけ出る（確認の対象導出は作った時点のもの）
    const balance = await getBalance(hinataCookie, tripId);
    expect(balance.status).toBe(200);
    expect(balance.body.targetCount).toBe(2);
    expect(
      balance.body.items.map(
        (item: { payment: { id: string } }) => item.payment.id,
      ),
    ).toEqual([first.body.id, second.body.id]);
    // +3,500 と −2,000 で 1,500 円があおいからひなたへ
    expect(balance.body.transfer).toMatchObject({
      signedTotalYen: "1500",
      fromUserId: aoi.userId,
      toUserId: hinata.userId,
    });
  });
});

describe("未完了の確認の一覧（FH-07）", () => {
  it("自分が作った未完了だけを新しい順で返す。完了済みは出ない", async () => {
    const tripId = await createTrip(hinataCookie);
    await createPayment(hinataCookie, tripId);

    const hinataFirst = await createPreview(hinataCookie, tripId);
    const aoiPreview = await createPreview(aoiCookie, tripId);
    const hinataSecond = await createPreview(hinataCookie, tripId);

    const mine = await listPreviews(hinataCookie, tripId);
    expect(mine.status).toBe(200);
    expect(mine.headers["cache-control"]).toBe("private, no-store");
    expect(
      mine.body.items.map((item: { id: string }) => item.id),
    ).toEqual([hinataSecond.body.id, hinataFirst.body.id]);
    for (const item of mine.body.items) {
      expect(item).toMatchObject({
        transfer: {
          signedTotalYen: "3500",
          amountYen: "3500",
          fromUserId: aoi.userId,
          toUserId: hinata.userId,
          requiresTransfer: true,
        },
        targetCount: 1,
        validation: {
          status: "ready",
          cancelledPaymentIds: [],
          changedPaymentIds: [],
          existingSettlementId: null,
        },
      });
    }
    expect(mine.body.nextCursor).toBeNull();

    // あおいの一覧にはあおいの確認だけ
    const theirs = await listPreviews(aoiCookie, tripId);
    expect(
      theirs.body.items.map((item: { id: string }) => item.id),
    ).toEqual([aoiPreview.body.id]);

    // 精算済みの確認は一覧から除く
    await adminSettlePreview(tripId, hinataSecond.body.id, hinata.userId);
    const afterSettle = await listPreviews(hinataCookie, tripId);
    expect(
      afterSettle.body.items.map((item: { id: string }) => item.id),
    ).toEqual([hinataFirst.body.id]);
  });

  it("同じミリ秒でマイクロ秒だけ違う確認がページの境目で抜けない", async () => {
    const tripId = await createTrip(hinataCookie, { name: "時刻の境目" });
    // 同じミリ秒でマイクロ秒だけ違う時刻と、同時刻の重複を入れる
    // （カーソルの起点を JS のミリ秒に丸めると境目の行が抜ける）。
    // previews は append-only で UPDATE できないため、時刻つきで直接入れる。
    const [first, second, third] = [
      "2027-01-01T10:00:00.123001Z",
      "2027-01-01T10:00:00.123002Z",
      "2027-01-01T10:00:00.123002Z",
    ].map((at) => ({ id: crypto.randomUUID(), at }));
    for (const { id, at } of [first, second, third]) {
      await db.admin.query(
        `INSERT INTO settlement.previews
           (id, trip_id, created_by, created_at, signed_total_yen)
         VALUES ($1, $2, $3, $4::timestamptz, 0)`,
        [id, tripId, hinata.userId, at],
      );
    }

    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const query =
        cursor === null
          ? "?limit=1"
          : `?limit=1&cursor=${encodeURIComponent(cursor)}`;
      const page = await listPreviews(hinataCookie, tripId, query);
      expect(page.status).toBe(200);
      expect(page.body.items).toHaveLength(1);
      ids.push((page.body.items as { id: string }[])[0]!.id);
      cursor = page.body.nextCursor;
    } while (cursor !== null);

    // 同時刻の 2 件は id の降順、そのあとに .123001 の確認
    const tieOrder = [second.id, third.id].sort().reverse();
    expect(ids).toEqual([tieOrder[0], tieOrder[1], first.id]);
  });

  it("limit と cursor で次のページを取る。壊れた・他人の・消えた確認の cursor は 400", async () => {
    const tripId = await createTrip(hinataCookie, { name: "ページの旅行" });
    await createPayment(hinataCookie, tripId);
    const first = await createPreview(hinataCookie, tripId);
    const second = await createPreview(hinataCookie, tripId);
    // 同じ旅行であおいが作った確認と、別の旅行で自分が作った確認
    const aoiPreview = await createPreview(aoiCookie, tripId);
    const otherTrip = await createTrip(hinataCookie, { name: "他の旅行" });
    await createPayment(hinataCookie, otherTrip);
    const elsewhere = await createPreview(hinataCookie, otherTrip);

    const page1 = await listPreviews(hinataCookie, tripId, "?limit=1");
    expect(page1.status).toBe(200);
    expect(page1.body.items.map((i: { id: string }) => i.id)).toEqual([
      second.body.id,
    ]);
    expect(page1.body.nextCursor).not.toBeNull();

    const page2 = await listPreviews(
      hinataCookie,
      tripId,
      `?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`,
    );
    expect(page2.status).toBe(200);
    expect(page2.body.items.map((i: { id: string }) => i.id)).toEqual([
      first.body.id,
    ]);
    expect(page2.body.nextCursor).toBeNull();

    // 形が違う・起点が無い・他人の・別の旅行の自分の確認を指す cursor は同じ 400
    for (const cursor of [
      "not-a-cursor",
      // 存在しない確認 id を指す正しい形のカーソル
      cursorOf(crypto.randomUUID()),
      // あおいの確認を指す（自分の一覧の起点にできない）
      cursorOf(aoiPreview.body.id),
      // 別の旅行で自分が作った確認を指す（この旅行の一覧の起点にできない）
      cursorOf(elsewhere.body.id),
    ]) {
      const response = await listPreviews(
        hinataCookie,
        tripId,
        `?cursor=${encodeURIComponent(cursor)}`,
      );
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: "INVALID_REQUEST" });
    }
    // status は pending だけ
    const badStatus = await listPreviews(hinataCookie, tripId, "?status=all");
    expect(badStatus.status).toBe(400);
  });
});

describe("確認の検証結果（FH-08）", () => {
  it("対象が変わった（別の確認で精算済みになった）→ target_changed", async () => {
    const tripId = await createTrip(hinataCookie);
    const payment = await createPayment(hinataCookie, tripId);
    const first = await createPreview(hinataCookie, tripId);
    const second = await createPreview(aoiCookie, tripId);

    // 管理者の接続から second の確認を精算済みにする
    const settlementId = await adminSettlePreview(
      tripId,
      second.body.id,
      aoi.userId,
    );

    const stale = await getPreview(hinataCookie, tripId, first.body.id);
    expect(stale.status).toBe(200);
    expect(stale.body.validation).toEqual({
      status: "target_changed",
      cancelledPaymentIds: [],
      changedPaymentIds: [payment.body.id],
      existingSettlementId: null,
    });

    const completed = await getPreview(hinataCookie, tripId, second.body.id);
    expect(completed.body.validation).toEqual({
      status: "already_completed",
      cancelledPaymentIds: [],
      changedPaymentIds: [],
      existingSettlementId: settlementId,
    });
  });

  it("完了後に取り消し → completed_then_cancelled", async () => {
    const tripId = await createTrip(hinataCookie);
    await createPayment(hinataCookie, tripId);
    const preview = await createPreview(hinataCookie, tripId);
    const settlementId = await adminSettlePreview(
      tripId,
      preview.body.id,
      hinata.userId,
    );
    await adminCancelSettlement(tripId, settlementId, aoi.userId);

    const response = await getPreview(hinataCookie, tripId, preview.body.id);
    expect(response.status).toBe(200);
    expect(response.body.validation).toEqual({
      status: "completed_then_cancelled",
      cancelledPaymentIds: [],
      changedPaymentIds: [],
      existingSettlementId: settlementId,
    });
  });

  it("BASE 対象の支払いがあとで取り消された → cancelled_items_ack_required", async () => {
    const tripId = await createTrip(hinataCookie);
    const payment = await createPayment(hinataCookie, tripId);
    const preview = await createPreview(hinataCookie, tripId);
    await cancelPayment(aoiCookie, tripId, payment.body.id);

    const response = await getPreview(hinataCookie, tripId, preview.body.id);
    expect(response.status).toBe(200);
    expect(response.body.validation).toEqual({
      status: "cancelled_items_ack_required",
      cancelledPaymentIds: [payment.body.id],
      changedPaymentIds: [],
      existingSettlementId: null,
    });
  });

  it("精算済みの支払いが取り消されると残額には戻し（−c）の対象が出る", async () => {
    const tripId = await createTrip(hinataCookie);
    const payment = await createPayment(hinataCookie, tripId, {
      amountYen: "7001",
      payerUserId: hinata.userId,
    });
    const settled = await createPreview(hinataCookie, tripId);
    await adminSettlePreview(tripId, settled.body.id, hinata.userId);

    // 残額の対象は 0 件（精算済み）
    const cleared = await getBalance(hinataCookie, tripId);
    expect(cleared.body.targetCount).toBe(0);

    await cancelPayment(hinataCookie, tripId, payment.body.id);

    const balance = await getBalance(hinataCookie, tripId);
    expect(balance.status).toBe(200);
    expect(balance.body.targetCount).toBe(1);
    expect(balance.body.items[0]).toMatchObject({
      kind: "REVERSAL",
      signedContributionYen: "-3500",
      payment: { id: payment.body.id },
    });
    expect(balance.body.items[0].baseSettlementId).not.toBeNull();
    // ひなたの 3,500 を戻す → ひなたからあおいへ
    expect(balance.body.transfer).toMatchObject({
      signedTotalYen: "-3500",
      amountYen: "3500",
      fromUserId: hinata.userId,
      toUserId: aoi.userId,
    });

    // 戻しの対象を含んだ確認を作れる（REVERSAL の明細の形が入る）
    const preview = await postPreview(hinataCookie, tripId);
    expect(preview.status).toBe(201);
    expect(preview.body.items[0]).toMatchObject({
      kind: "REVERSAL",
      signedContributionYen: "-3500",
      payment: {
        id: payment.body.id,
        cancellation: { targetId: payment.body.id },
      },
    });
    expect(preview.body.items[0].baseSettlementId).not.toBeNull();
    expect(preview.body.transfer.signedTotalYen).toBe("-3500");
    expect(preview.body.validation.status).toBe("ready");
  });
});

describe("確認の作成の再送", () => {
  it("同じキーの再送は同じ確認を返し、別の旅行への使い回しは 409", async () => {
    const tripA = await createTrip(hinataCookie);
    const tripB = await createTrip(hinataCookie, { name: "別の旅行" });
    await createPayment(hinataCookie, tripA);
    await createPayment(hinataCookie, tripB);
    const key = newKey();

    const created = await postPreview(hinataCookie, tripA, key);
    expect(created.status).toBe(201);

    const replay = await postPreview(hinataCookie, tripA, key);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(created.body);
    expect(await previewCount(tripA)).toBe(1);

    // 同じキーを別の旅行へ: 受領の hash が違うので 409（本文が常に空でも
    // tripId が request_hash に入る）
    const reused = await postPreview(hinataCookie, tripB, key);
    expect(reused.status).toBe(409);
    expect(reused.body).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(await previewCount(tripB)).toBe(0);
  });
});

describe("認可と不在（403・404）", () => {
  it("参加しない・存在しない旅行は 4 経路すべて同じ 403", async () => {
    const foreign = await seedForeignTrip();
    const missingTrip = crypto.randomUUID();

    for (const target of [foreign.tripId, missingTrip]) {
      const balance = await getBalance(hinataCookie, target);
      expect(balance.status).toBe(403);
      expect(balance.body).toMatchObject({ code: "TRIP_NOT_ACCESSIBLE" });

      const create = await postPreview(hinataCookie, target);
      expect(create.status).toBe(403);
      expect(create.body).toMatchObject({ code: "TRIP_NOT_ACCESSIBLE" });

      const list = await listPreviews(hinataCookie, target);
      expect(list.status).toBe(403);
      expect(list.body).toMatchObject({ code: "TRIP_NOT_ACCESSIBLE" });

      const get = await getPreview(hinataCookie, target, crypto.randomUUID());
      expect(get.status).toBe(403);
      expect(get.body).toMatchObject({ code: "TRIP_NOT_ACCESSIBLE" });
    }
  });

  it("旅行の中に無い確認は 404（無い id と別の旅行の確認は同じ応答）", async () => {
    const tripId = await createTrip(hinataCookie);
    await createPayment(hinataCookie, tripId);
    const otherTrip = await createTrip(hinataCookie, { name: "別の旅行" });
    await createPayment(hinataCookie, otherTrip);
    const elsewhere = await createPreview(hinataCookie, otherTrip);

    const missing = await getPreview(
      hinataCookie,
      tripId,
      crypto.randomUUID(),
    );
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: "PREVIEW_NOT_FOUND" });

    const foreign = await getPreview(hinataCookie, tripId, elsewhere.body.id);
    expect(foreign.status).toBe(404);
    // 無い id と別の旅行の確認は同じ応答（存在を漏らさない）
    expect({ ...foreign.body, requestId: null }).toEqual({
      ...missing.body,
      requestId: null,
    });

    // 確認はその旅行の中では開ける
    const own = await getPreview(aoiCookie, tripId, (
      await createPreview(hinataCookie, tripId)
    ).body.id);
    expect(own.status).toBe(200);
  });
});
