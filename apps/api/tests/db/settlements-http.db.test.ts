import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import type { Auth } from "better-auth";
import type { TestHelpers } from "better-auth/plugins";
import { testUtils } from "better-auth/plugins";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UnitOfWork } from "../../src/adapter/transaction/unit-of-work";
import { AppModule } from "../../src/app.module";
import { closePool, getPool } from "../../src/infrastructure/database/pool";
import { createAuth } from "../../src/modules/identity/infrastructure/better-auth";
import {
  SETTLEMENT_UNIT_OF_WORK,
  type SettlementWorkContext,
} from "../../src/modules/settlement/adapter/outbound/settlement-work-context";
import { PgFinanceUnitOfWork } from "../../src/modules/settlement/infrastructure/pg-finance-unit-of-work";
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
  name: "精算の旅行",
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

async function createPayment(
  cookie: string,
  tripId: string,
  overrides: Record<string, unknown> = {},
): Promise<request.Response> {
  const response = await authed(
    http().post(`/api/trips/${tripId}/payments`),
    cookie,
  )
    .set("Idempotency-Key", newKey())
    .send(paymentBody(overrides));
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

async function createPreview(
  cookie: string,
  tripId: string,
): Promise<request.Response> {
  const response = await authed(
    http().post(`/api/trips/${tripId}/settlement-previews`),
    cookie,
  ).set("Idempotency-Key", newKey());
  expect(response.status).toBe(201);
  return response;
}

async function postSettlement(
  cookie: string,
  tripId: string,
  body: unknown,
  key = newKey(),
): Promise<request.Response> {
  return authed(http().post(`/api/trips/${tripId}/settlements`), cookie)
    .set("Idempotency-Key", key)
    .send(body);
}

function settlementBody(
  previewId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    previewId,
    completionKind: "transfer_completed",
    acknowledgedCancellationPaymentIds: [],
    ...overrides,
  };
}

/** 確認を完了して201の精算（応答本体）を返す。 */
async function settle(
  cookie: string,
  tripId: string,
  previewId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const response = await postSettlement(
    cookie,
    tripId,
    settlementBody(previewId, overrides),
  );
  expect(response.status).toBe(201);
  return response.body as { id: string };
}

async function listSettlements(
  cookie: string,
  tripId: string,
  query = "",
): Promise<request.Response> {
  return authed(http().get(`/api/trips/${tripId}/settlements${query}`), cookie);
}

async function getSettlement(
  cookie: string,
  tripId: string,
  settlementId: string,
): Promise<request.Response> {
  return authed(
    http().get(`/api/trips/${tripId}/settlements/${settlementId}`),
    cookie,
  );
}

async function postSettlementCancel(
  cookie: string,
  tripId: string,
  settlementId: string,
  key = newKey(),
): Promise<request.Response> {
  return authed(
    http().post(`/api/trips/${tripId}/settlements/${settlementId}/cancel`),
    cookie,
  ).set("Idempotency-Key", key);
}

/**
 * 精算まわりの行数。receiptsはこの機能の受領（settlement /
 * settlement_cancellation）だけ数える（旅行・支払い・確認の受領を混ぜない）。
 */
async function tableCounts(tripId: string): Promise<{
  settlements: number;
  items: number;
  claims: number;
  cancellations: number;
  receipts: number;
}> {
  const result = await db.admin.query<{
    settlements: string;
    items: string;
    claims: string;
    cancellations: string;
    receipts: string;
  }>(
    `SELECT
       (SELECT count(*) FROM settlement.settlements WHERE trip_id = $1)::text AS settlements,
       (SELECT count(*) FROM settlement.items WHERE trip_id = $1)::text AS items,
       (SELECT count(*) FROM settlement.active_claims WHERE trip_id = $1)::text AS claims,
       (SELECT count(*) FROM settlement.cancellations WHERE trip_id = $1)::text AS cancellations,
       (SELECT count(*) FROM infra.command_receipts
          WHERE trip_id = $1
            AND resource_type IN ('settlement', 'settlement_cancellation'))::text AS receipts`,
    [tripId],
  );
  const row = result.rows[0]!;
  return {
    settlements: Number(row.settlements),
    items: Number(row.items),
    claims: Number(row.claims),
    cancellations: Number(row.cancellations),
    receipts: Number(row.receipts),
  };
}

/**
 * trip_finance_guardsの行ロックで待っている実行がminWaiters件
 * 現れるまで見る（時間待ちにしない）。札の表へのロックを持つ接続に
 * 塞がれている接続をpg_blocking_pidsで数える。行そのものの待ち
 * （tuple）と、保持側のxactを待つ待ち（transactionid）の両方を拾う。
 * 後から来た待ちは先の待ちに塞がれるので、遮る側が表のロックを
 * 持つことだけを条件にする（モードは問わない）。
 * app_runtimeのlock_timeoutは3秒なので、待ちを検出したら速やかに解放する。
 */
async function waitForGuardLockWaiters(
  minWaiters: number,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await db.admin.query<{ c: string }>(
      `SELECT count(*)::text AS c
         FROM pg_stat_activity a
        WHERE a.wait_event_type = 'Lock'
          AND EXISTS (
            SELECT 1
              FROM pg_locks h
             WHERE h.relation = 'infra.trip_finance_guards'::regclass
               AND h.granted
               AND h.pid = ANY (pg_blocking_pids(a.pid))
          )`,
    );
    if (Number(result.rows[0]!.c) >= minWaiters) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for the finance guard lock waiters");
}

/** ひなたが参加しない旅行を別利用者2人で直接作る（guardの行も入れる）。 */
async function seedForeignTrip(): Promise<{ tripId: string }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const u0 = await insertUser(
    `foreign-${suffix}-0`,
    `foreign-${suffix}-0@example.test`,
  );
  const u1 = await insertUser(
    `foreign-${suffix}-1`,
    `foreign-${suffix}-1@example.test`,
  );
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

/** 別の旅行の精算を1件作り、そのidを返す（cursorの起点の検証用）。 */
async function seedForeignSettlement(tripId: string): Promise<string> {
  const preview = await db.admin.query<{ id: string }>(
    `INSERT INTO settlement.previews (trip_id, created_by, signed_total_yen)
     SELECT $1, user_id, 0 FROM planning.trip_participants
      WHERE trip_id = $1 AND slot = 0
     RETURNING id`,
    [tripId],
  );
  const settlement = await db.admin.query<{ id: string }>(
    `INSERT INTO settlement.settlements
       (trip_id, preview_id, sequence, signed_total_yen, completion_kind, created_by)
     SELECT $1, $2, 1, 0, 'no_transfer_required', user_id
       FROM planning.trip_participants
      WHERE trip_id = $1 AND slot = 0
     RETURNING id`,
    [tripId, preview.rows[0]!.id],
  );
  return settlement.rows[0]!.id;
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

describe("完了の記録（FH-09）", () => {
  it("非 0 円は transfer_completed・連番 1・明細と占有と受領が残る（相手の確認でも完了できる）", async () => {
    const tripId = await createTrip(hinataCookie);
    const payment = await createPayment(hinataCookie, tripId, {
      label: "宿泊費",
    });
    // あおいが作った確認をひなたが完了する（作成者の制限は無い）
    const preview = await createPreview(aoiCookie, tripId);

    const response = await postSettlement(
      hinataCookie,
      tripId,
      settlementBody(preview.body.id),
    );

    expect(response.status).toBe(201);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toMatchObject({
      tripId,
      previewId: preview.body.id,
      sequence: "1",
      createdBy: hinata.userId,
      completionKind: "transfer_completed",
      transfer: {
        signedTotalYen: "3500",
        amountYen: "3500",
        fromUserId: aoi.userId,
        toUserId: hinata.userId,
        requiresTransfer: true,
      },
      cancellation: null,
      canCancel: true,
      cannotCancelReason: null,
    });
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      kind: "BASE",
      signedContributionYen: "3500",
      baseSettlementId: null,
      payment: { id: payment.body.id, label: "宿泊費" },
    });

    const counts = await tableCounts(tripId);
    expect(counts).toEqual({
      settlements: 1,
      items: 1,
      claims: 1,
      cancellations: 0,
      receipts: 1,
    });
    const receipt = await db.admin.query(
      `SELECT operation, resource_type, http_status
         FROM infra.command_receipts WHERE resource_id = $1`,
      [response.body.id],
    );
    expect(receipt.rows).toEqual([
      {
        operation: "completeSettlement",
        resource_type: "settlement",
        http_status: 201,
      },
    ]);
  });

  it("0 円の確認は no_transfer_required で 201。種類を間違えると 422 で何も残らない", async () => {
    const tripId = await createTrip(hinataCookie, { name: "0 円の旅行" });
    await createPayment(hinataCookie, tripId, {
      amountYen: "7001",
      payerUserId: hinata.userId,
    });
    await createPayment(hinataCookie, tripId, {
      amountYen: "7001",
      payerUserId: aoi.userId,
    });
    const preview = await createPreview(hinataCookie, tripId);
    const before = await tableCounts(tripId);

    const wrong = await postSettlement(
      hinataCookie,
      tripId,
      settlementBody(preview.body.id),
    );
    expect(wrong.status).toBe(422);
    expect(wrong.body).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await tableCounts(tripId)).toEqual(before);

    const response = await postSettlement(
      hinataCookie,
      tripId,
      settlementBody(preview.body.id, {
        completionKind: "no_transfer_required",
      }),
    );
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      sequence: "1",
      completionKind: "no_transfer_required",
      transfer: {
        signedTotalYen: "0",
        amountYen: "0",
        fromUserId: null,
        toUserId: null,
        requiresTransfer: false,
      },
    });
    const counts = await tableCounts(tripId);
    expect(counts.settlements).toBe(1);
    expect(counts.receipts).toBe(1);
  });

  it("有効な精算がある確認への完了は 200 で同じ精算を返し、行は増えない（E-07）", async () => {
    const tripId = await createTrip(hinataCookie);
    await createPayment(hinataCookie, tripId);
    const preview = await createPreview(hinataCookie, tripId);
    const created = await settle(hinataCookie, tripId, preview.body.id);
    const before = await tableCounts(tripId);

    const again = await postSettlement(
      aoiCookie,
      tripId,
      settlementBody(preview.body.id),
    );

    expect(again.status).toBe(200);
    expect(again.body.id).toBe(created.id);
    expect(again.body.sequence).toBe("1");
    const after = await tableCounts(tripId);
    expect(after.settlements).toBe(before.settlements);
    expect(after.items).toBe(before.items);
    expect(after.claims).toBe(before.claims);
    // 受領は別の利用者・別のキーの分が1件残る（200で既存を返した記録）
    expect(after.receipts).toBe(before.receipts + 1);
  });
});

describe("対象の変化と取り消し例外（FH-10・FH-11・FH-12）", () => {
  it("FH-10: 確認のあとに別の精算が立って取り消されると 409 PREVIEW_CHANGED", async () => {
    const tripId = await createTrip(hinataCookie);
    const payment = await createPayment(hinataCookie, tripId);
    const stale = await createPreview(hinataCookie, tripId);
    const other = await createPreview(aoiCookie, tripId);

    // 別の確認で同じ対象を精算し、その精算を取り消す
    // （指紋が変わるが占有は残らない → PREVIEW_CHANGED）
    const done = await settle(aoiCookie, tripId, other.body.id);
    const cancelled = await postSettlementCancel(aoiCookie, tripId, done.id);
    expect(cancelled.status).toBe(201);

    const response = await postSettlement(
      hinataCookie,
      tripId,
      settlementBody(stale.body.id),
    );
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "PREVIEW_CHANGED" });
    // 指紋が変わった対象の支払いIDが本文に出る
    expect(response.body.changedPaymentIds).toEqual([payment.body.id]);
    expect((await tableCounts(tripId)).settlements).toBe(1);
  });

  it("FH-11: 取り消し済み BASE 対象は、了承の集合が完全一致したときだけ完了できる", async () => {
    const tripId = await createTrip(hinataCookie);
    const payment = await createPayment(hinataCookie, tripId);
    const preview = await createPreview(hinataCookie, tripId);
    await cancelPayment(aoiCookie, tripId, payment.body.id);

    // 了承なし → 409
    const noAck = await postSettlement(
      hinataCookie,
      tripId,
      settlementBody(preview.body.id),
    );
    expect(noAck.status).toBe(409);
    expect(noAck.body).toMatchObject({
      code: "CANCELLED_ITEMS_ACK_REQUIRED",
    });

    // 集合が違う → 409
    const wrong = await postSettlement(
      hinataCookie,
      tripId,
      settlementBody(preview.body.id, {
        acknowledgedCancellationPaymentIds: [crypto.randomUUID()],
      }),
    );
    expect(wrong.status).toBe(409);
    expect(wrong.body).toMatchObject({
      code: "CANCELLED_ITEMS_ACK_REQUIRED",
    });
    expect((await tableCounts(tripId)).settlements).toBe(0);

    // 完全一致 → 201（完了の記録に取り消し済み支払いのBASE明細が残る）
    const settled = await postSettlement(
      hinataCookie,
      tripId,
      settlementBody(preview.body.id, {
        acknowledgedCancellationPaymentIds: [payment.body.id],
      }),
    );
    expect(settled.status).toBe(201);
    expect(settled.body.items).toEqual([
      expect.objectContaining({
        kind: "BASE",
        signedContributionYen: "3500",
        payment: expect.objectContaining({
          id: payment.body.id,
          cancellation: expect.objectContaining({
            targetId: payment.body.id,
          }),
        }),
      }),
    ]);

    // 次の残額には戻し（REVERSAL）がちょうど1件出る
    const balance = await getBalance(hinataCookie, tripId);
    expect(balance.body.items).toEqual([
      expect.objectContaining({
        kind: "REVERSAL",
        signedContributionYen: "-3500",
        baseSettlementId: settled.body.id,
        payment: expect.objectContaining({ id: payment.body.id }),
      }),
    ]);
    const next = await createPreview(hinataCookie, tripId);
    expect(
      next.body.items.filter(
        (item: { kind: string }) => item.kind === "REVERSAL",
      ),
    ).toHaveLength(1);
    expect(next.body.items[0]).toMatchObject({
      kind: "REVERSAL",
      baseSettlementId: settled.body.id,
    });
  });

  it("FH-12: 完了 → 取り消し → 同じ確認への完了は 409（新しい確認へ）", async () => {
    const tripId = await createTrip(hinataCookie);
    await createPayment(hinataCookie, tripId);
    const preview = await createPreview(hinataCookie, tripId);
    const settled = await settle(hinataCookie, tripId, preview.body.id);
    const cancelled = await postSettlementCancel(
      hinataCookie,
      tripId,
      settled.id,
    );
    expect(cancelled.status).toBe(201);

    const again = await postSettlement(
      hinataCookie,
      tripId,
      settlementBody(preview.body.id),
    );
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: "PREVIEW_CHANGED" });
    expect((await tableCounts(tripId)).settlements).toBe(1);
  });

  it("同じ対象を別の確認で済ませた精算があれば 409 TARGET_ALREADY_SETTLED（existingSettlementIdが本文に出る）", async () => {
    const tripId = await createTrip(hinataCookie);
    await createPayment(hinataCookie, tripId);
    // 同じ対象を2枚の確認が掴んでいる状態で片方で精算する
    const first = await createPreview(hinataCookie, tripId);
    const second = await createPreview(aoiCookie, tripId);
    const settled = await settle(hinataCookie, tripId, first.body.id);

    const response = await postSettlement(
      aoiCookie,
      tripId,
      settlementBody(second.body.id),
    );
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: "TARGET_ALREADY_SETTLED",
      // 既存の精算を表示する手がかりを本文に添える
      existingSettlementId: settled.id,
    });
    expect((await tableCounts(tripId)).settlements).toBe(1);
  });
});

describe("精算の取り消し（FH-13・FH-14）", () => {
  it("FH-13: 最新でない有効な精算は取り消せない。最新を取り消すと次が取り消せる", async () => {
    const tripId = await createTrip(hinataCookie);
    await createPayment(hinataCookie, tripId);
    const first = await settle(
      hinataCookie,
      tripId,
      (await createPreview(hinataCookie, tripId)).body.id,
    );
    // 次の対象を足して2件目の精算（連番2）
    await createPayment(hinataCookie, tripId, {
      amountYen: "4001",
      payerUserId: aoi.userId,
    });
    const second = await settle(
      aoiCookie,
      tripId,
      (await createPreview(aoiCookie, tripId)).body.id,
    );

    const older = await postSettlementCancel(hinataCookie, tripId, first.id);
    expect(older.status).toBe(409);
    expect(older.body).toMatchObject({ code: "SETTLEMENT_NOT_LATEST" });
    expect((await tableCounts(tripId)).cancellations).toBe(0);

    const latest = await postSettlementCancel(hinataCookie, tripId, second.id);
    expect(latest.status).toBe(201);
    expect(latest.body).toMatchObject({
      targetId: second.id,
      cancelledBy: hinata.userId,
    });

    // 新しい方が取り消されたので、残った精算が最新の有効な精算になる
    const nowLatest = await postSettlementCancel(aoiCookie, tripId, first.id);
    expect(nowLatest.status).toBe(201);

    const counts = await tableCounts(tripId);
    expect(counts.cancellations).toBe(2);
    expect(counts.claims).toBe(0);
  });

  it("FH-14: 支払いの取り消しと精算の取り消しの順を入れ替えても残額は同じ", async () => {
    // 順A: 精算 → 支払いの取り消し → 精算の取り消し
    const tripA = await createTrip(hinataCookie, { name: "順 A" });
    const paymentA = await createPayment(hinataCookie, tripA);
    const settledA = await settle(
      hinataCookie,
      tripA,
      (await createPreview(hinataCookie, tripA)).body.id,
    );
    expect((await cancelPayment(hinataCookie, tripA, paymentA.body.id)).status)
      .toBe(201);
    expect((await postSettlementCancel(hinataCookie, tripA, settledA.id)).status)
      .toBe(201);

    // 順B: 精算 → 精算の取り消し → 支払いの取り消し
    const tripB = await createTrip(hinataCookie, { name: "順 B" });
    const paymentB = await createPayment(hinataCookie, tripB);
    const settledB = await settle(
      hinataCookie,
      tripB,
      (await createPreview(hinataCookie, tripB)).body.id,
    );
    expect((await postSettlementCancel(hinataCookie, tripB, settledB.id)).status)
      .toBe(201);
    expect((await cancelPayment(hinataCookie, tripB, paymentB.body.id)).status)
      .toBe(201);

    for (const trip of [tripA, tripB]) {
      const balance = await getBalance(hinataCookie, trip);
      expect(balance.status).toBe(200);
      // 取り消した支払いは残額に戻らない
      expect(balance.body.targetCount).toBe(0);
      expect(balance.body.items).toEqual([]);
      expect(balance.body.transfer).toMatchObject({
        signedTotalYen: "0",
        amountYen: "0",
        requiresTransfer: false,
      });
    }
  });
});

describe("精算の一覧と取得", () => {
  it("連番の降順・取り消し状態と取り消せるかが各件に付く。ページはカーソルで続く", async () => {
    const tripId = await createTrip(hinataCookie);
    await createPayment(hinataCookie, tripId);
    const first = await settle(
      hinataCookie,
      tripId,
      (await createPreview(hinataCookie, tripId)).body.id,
    );
    await createPayment(hinataCookie, tripId, {
      amountYen: "4001",
      payerUserId: aoi.userId,
    });
    const second = await settle(
      aoiCookie,
      tripId,
      (await createPreview(aoiCookie, tripId)).body.id,
    );
    await postSettlementCancel(aoiCookie, tripId, second.id);

    const page1 = await listSettlements(hinataCookie, tripId, "?limit=1");
    expect(page1.status).toBe(200);
    expect(page1.headers["cache-control"]).toBe("private, no-store");
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.items[0]).toMatchObject({
      id: second.id,
      sequence: "2",
      createdBy: aoi.userId,
      completionKind: "transfer_completed",
      cancellation: expect.objectContaining({
        targetId: second.id,
        cancelledBy: aoi.userId,
      }),
      canCancel: false,
      cannotCancelReason: "already_cancelled",
    });
    expect(page1.body.items[0].items[0]).toMatchObject({ kind: "BASE" });
    expect(page1.body.nextCursor).not.toBeNull();

    const page2 = await listSettlements(
      hinataCookie,
      tripId,
      `?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`,
    );
    expect(page2.status).toBe(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0]).toMatchObject({
      id: first.id,
      sequence: "1",
      cancellation: null,
      // 新しい方が取り消されたので、残った精算が取り消せる
      canCancel: true,
      cannotCancelReason: null,
    });
    expect(page2.body.nextCursor).toBeNull();

    // 不正なカーソル・消えた起点・別の旅行の起点・範囲外の件数は同じ400
    const cursorOf = (id: string) =>
      Buffer.from(JSON.stringify({ i: id }), "utf8").toString("base64url");
    const foreign = await seedForeignTrip();
    const foreignSettlementId = await seedForeignSettlement(foreign.tripId);
    for (const query of [
      `?cursor=${encodeURIComponent("not-a-cursor")}`,
      `?cursor=${encodeURIComponent(cursorOf(crypto.randomUUID()))}`,
      `?cursor=${encodeURIComponent(cursorOf(foreignSettlementId))}`,
      "?limit=0",
      "?limit=101",
    ]) {
      const bad = await listSettlements(hinataCookie, tripId, query);
      expect(bad.status).toBe(400);
    }
  });

  it("取得は元の明細・記録した人・取り消し履歴を返す", async () => {
    const tripId = await createTrip(hinataCookie);
    const payment = await createPayment(hinataCookie, tripId);
    const preview = await createPreview(hinataCookie, tripId);
    const settled = await settle(hinataCookie, tripId, preview.body.id);

    const fetched = await getSettlement(aoiCookie, tripId, settled.id);
    expect(fetched.status).toBe(200);
    expect(fetched.headers["cache-control"]).toBe("private, no-store");
    expect(fetched.body).toMatchObject({
      id: settled.id,
      tripId,
      previewId: preview.body.id,
      sequence: "1",
      createdBy: hinata.userId,
      completionKind: "transfer_completed",
      transfer: {
        signedTotalYen: "3500",
        fromUserId: aoi.userId,
        toUserId: hinata.userId,
        requiresTransfer: true,
      },
      cancellation: null,
      canCancel: true,
      cannotCancelReason: null,
    });
    expect(fetched.body.items[0].payment.id).toBe(payment.body.id);
  });
});

describe("完了・取り消しの再送", () => {
  it("同じキー・同じ要求の再送は同じ精算を返し、行は増えない。別の要求への使い回しは 409", async () => {
    const tripId = await createTrip(hinataCookie);
    await createPayment(hinataCookie, tripId);
    const preview = await createPreview(hinataCookie, tripId);
    const key = newKey();

    const created = await postSettlement(
      hinataCookie,
      tripId,
      settlementBody(preview.body.id),
      key,
    );
    expect(created.status).toBe(201);
    const replay = await postSettlement(
      hinataCookie,
      tripId,
      settlementBody(preview.body.id),
      key,
    );
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(created.body);
    expect((await tableCounts(tripId)).settlements).toBe(1);

    // 同じキーで別の要求（支払いを足したあと作った別の確認の完了）は409
    await createPayment(hinataCookie, tripId, {
      amountYen: "4001",
      payerUserId: aoi.userId,
    });
    const other = await createPreview(hinataCookie, tripId);
    const reused = await postSettlement(
      hinataCookie,
      tripId,
      settlementBody(other.body.id),
      key,
    );
    expect(reused.status).toBe(409);
    expect(reused.body).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect((await tableCounts(tripId)).settlements).toBe(1);
  });

  it("取り消しの再送は同じ取り消しを返し、別のキーなら既存の取り消しを 200 で返す", async () => {
    const tripId = await createTrip(hinataCookie);
    await createPayment(hinataCookie, tripId);
    const settled = await settle(
      hinataCookie,
      tripId,
      (await createPreview(hinataCookie, tripId)).body.id,
    );
    const key = newKey();
    const created = await postSettlementCancel(
      hinataCookie,
      tripId,
      settled.id,
      key,
    );
    expect(created.status).toBe(201);
    const replay = await postSettlementCancel(
      hinataCookie,
      tripId,
      settled.id,
      key,
    );
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(created.body);

    const again = await postSettlementCancel(aoiCookie, tripId, settled.id);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(created.body);
    expect((await tableCounts(tripId)).cancellations).toBe(1);
  });
});

describe("同時実行の整合（FD-05〜FD-12）", () => {
  it("FD-05: 同じ確認への同時完了は 1 件だけ立ち、負けた側は既存の精算を 200 で受け取る", async () => {
    const tripId = await createTrip(hinataCookie);
    await createPayment(hinataCookie, tripId);
    const preview = await createPreview(hinataCookie, tripId);

    // 両方の要求が札の行ロックで本当に待つのを確かめてから放つ
    const holder = await db.admin.connect();
    let first: Promise<request.Response>;
    let second: Promise<request.Response>;
    try {
      await holder.query("BEGIN");
      await holder.query(
        "SELECT trip_id FROM infra.trip_finance_guards WHERE trip_id = $1 FOR UPDATE",
        [tripId],
      );
      first = postSettlement(
        hinataCookie,
        tripId,
        settlementBody(preview.body.id),
      );
      second = postSettlement(
        aoiCookie,
        tripId,
        settlementBody(preview.body.id),
      );
      await waitForGuardLockWaiters(2);
    } finally {
      await holder.query("COMMIT");
      holder.release();
    }

    const [a, b] = await Promise.all([first!, second!]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.id).toBe(b.body.id);
    const counts = await tableCounts(tripId);
    expect(counts.settlements).toBe(1);
    expect(counts.items).toBe(1);
    expect(counts.claims).toBe(1);
    // 両方の受領が残る（勝ちは201、負けは既存参照の200）
    expect(counts.receipts).toBe(2);
  }, 30_000);

  it("FD-06: 一部だけ重なる2つの確認の同時完了は、片方だけ201・片方は409 TARGET_PARTIALLY_SETTLED", async () => {
    const tripId = await createTrip(hinataCookie);
    const payment = await createPayment(hinataCookie, tripId);
    // 対象1件の確認（この時点で未精算の対象は1件だけ）
    const partial = await createPreview(hinataCookie, tripId);
    await createPayment(hinataCookie, tripId, {
      amountYen: "4001",
      payerUserId: aoi.userId,
    });
    // 対象2件の確認
    const full = await createPreview(aoiCookie, tripId);
    expect(full.body.items).toHaveLength(2);

    // 小さい方の完了を先に待たせてから大きい方を送る（行ロックはFIFOで
    // 先着に付く）→ partialが立ち、fullは一部占有で弾かれる
    const holder = await db.admin.connect();
    let first: Promise<request.Response>;
    let second: Promise<request.Response>;
    try {
      await holder.query("BEGIN");
      await holder.query(
        "SELECT trip_id FROM infra.trip_finance_guards WHERE trip_id = $1 FOR UPDATE",
        [tripId],
      );
      first = postSettlement(
        hinataCookie,
        tripId,
        settlementBody(partial.body.id),
      );
      await waitForGuardLockWaiters(1);
      second = postSettlement(
        aoiCookie,
        tripId,
        settlementBody(full.body.id),
      );
      await waitForGuardLockWaiters(2);
    } finally {
      await holder.query("COMMIT");
      holder.release();
    }

    const [won, lost] = await Promise.all([first!, second!]);
    expect(won.status).toBe(201);
    expect(lost.status).toBe(409);
    expect(lost.body).toMatchObject({
      code: "TARGET_PARTIALLY_SETTLED",
    });
    // 指紋が変わった対象の支払いIDが本文に出る
    expect(lost.body.changedPaymentIds).toEqual([payment.body.id]);
    const counts = await tableCounts(tripId);
    expect(counts.settlements).toBe(1);
    // 占有は勝った側の1件だけ残る
    const claims = await db.admin.query(
      "SELECT settlement_id FROM settlement.active_claims WHERE trip_id = $1",
      [tripId],
    );
    expect(claims.rows).toEqual([{ settlement_id: won.body.id }]);
  }, 30_000);

  it("FD-07: 支払いの取り消しと完了の記録が並ぶと、先に来た方の結果と残額が一致する", async () => {
    // 順A: 支払いの取り消しが先 → 完了は409（了承が要る）
    const tripA = await createTrip(hinataCookie, { name: "取消先" });
    const paymentA = await createPayment(hinataCookie, tripA);
    const previewA = await createPreview(hinataCookie, tripA);

    const holderA = await db.admin.connect();
    let cancelA: Promise<request.Response>;
    let completeA: Promise<request.Response>;
    try {
      await holderA.query("BEGIN");
      await holderA.query(
        "SELECT trip_id FROM infra.trip_finance_guards WHERE trip_id = $1 FOR UPDATE",
        [tripA],
      );
      cancelA = cancelPayment(aoiCookie, tripA, paymentA.body.id);
      await waitForGuardLockWaiters(1);
      completeA = postSettlement(
        hinataCookie,
        tripA,
        settlementBody(previewA.body.id),
      );
      await waitForGuardLockWaiters(2);
    } finally {
      await holderA.query("COMMIT");
      holderA.release();
    }
    const [cancelledA, completedA] = await Promise.all([cancelA!, completeA!]);
    expect(cancelledA.status).toBe(201);
    expect(completedA.status).toBe(409);
    expect(completedA.body).toMatchObject({
      code: "CANCELLED_ITEMS_ACK_REQUIRED",
    });
    // 精算前に取り消された支払いは残額から消えたまま
    const balanceA = await getBalance(hinataCookie, tripA);
    expect(balanceA.body.targetCount).toBe(0);
    expect((await tableCounts(tripA)).settlements).toBe(0);

    // 順B: 完了の記録が先 → 支払いは精算済みのまま取り消され、
    // 残額には戻し（REVERSAL）が1件出る
    const tripB = await createTrip(hinataCookie, { name: "完了先" });
    const paymentB = await createPayment(hinataCookie, tripB);
    const previewB = await createPreview(hinataCookie, tripB);

    const holderB = await db.admin.connect();
    let completeB: Promise<request.Response>;
    let cancelB: Promise<request.Response>;
    try {
      await holderB.query("BEGIN");
      await holderB.query(
        "SELECT trip_id FROM infra.trip_finance_guards WHERE trip_id = $1 FOR UPDATE",
        [tripB],
      );
      completeB = postSettlement(
        hinataCookie,
        tripB,
        settlementBody(previewB.body.id),
      );
      await waitForGuardLockWaiters(1);
      cancelB = cancelPayment(aoiCookie, tripB, paymentB.body.id);
      await waitForGuardLockWaiters(2);
    } finally {
      await holderB.query("COMMIT");
      holderB.release();
    }
    const [completedB, cancelledB] = await Promise.all([completeB!, cancelB!]);
    expect(completedB.status).toBe(201);
    expect(cancelledB.status).toBe(201);
    const balanceB = await getBalance(hinataCookie, tripB);
    expect(balanceB.body.items).toEqual([
      expect.objectContaining({
        kind: "REVERSAL",
        signedContributionYen: "-3500",
        baseSettlementId: completedB.body.id,
      }),
    ]);
  }, 30_000);

  it("FD-08: 同じ精算への同時取り消しは 1 件だけ追記され、負けた側は 200 で既存を受け取る", async () => {
    const tripId = await createTrip(hinataCookie);
    await createPayment(hinataCookie, tripId);
    const settled = await settle(
      hinataCookie,
      tripId,
      (await createPreview(hinataCookie, tripId)).body.id,
    );

    const holder = await db.admin.connect();
    let first: Promise<request.Response>;
    let second: Promise<request.Response>;
    try {
      await holder.query("BEGIN");
      await holder.query(
        "SELECT trip_id FROM infra.trip_finance_guards WHERE trip_id = $1 FOR UPDATE",
        [tripId],
      );
      first = postSettlementCancel(hinataCookie, tripId, settled.id);
      second = postSettlementCancel(aoiCookie, tripId, settled.id);
      await waitForGuardLockWaiters(2);
    } finally {
      await holder.query("COMMIT");
      holder.release();
    }

    const [a, b] = await Promise.all([first!, second!]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body).toEqual(b.body);
    const counts = await tableCounts(tripId);
    expect(counts.cancellations).toBe(1);
    expect(counts.claims).toBe(0);
  }, 30_000);

  it("FD-09: 占有や受領の保存が失敗したら精算・明細・受領も残らない", async () => {
    const realUoW = new PgFinanceUnitOfWork(runtimePool);
    for (const failOn of ["claims", "receipt"] as const) {
      const failingUoW: UnitOfWork<SettlementWorkContext> = {
        run: (work) =>
          realUoW.run((ctx) =>
            work({
              ...ctx,
              settlements:
                failOn === "claims"
                  ? new Proxy(ctx.settlements, {
                      get(target, prop, receiver) {
                        if (prop === "insertActiveClaims") {
                          return () =>
                            Promise.reject(
                              new Error("injected claims failure"),
                            );
                        }
                        return Reflect.get(target, prop, receiver);
                      },
                    })
                  : ctx.settlements,
              receipts:
                failOn === "receipt"
                  ? new Proxy(ctx.receipts, {
                      get(target, prop, receiver) {
                        if (prop === "insert") {
                          return () =>
                            Promise.reject(
                              new Error("injected receipt failure"),
                            );
                        }
                        return Reflect.get(target, prop, receiver);
                      },
                    })
                  : ctx.receipts,
            }),
          ),
      };
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(SETTLEMENT_UNIT_OF_WORK)
        .useValue(failingUoW)
        .compile();
      const failApp = await createHttpTestApp(moduleRef, auth);
      try {
        const tripId = await createTrip(hinataCookie);
        await createPayment(hinataCookie, tripId);
        const preview = await createPreview(hinataCookie, tripId);
        const before = await tableCounts(tripId);

        const response = await authed(
          request(failApp.getHttpServer()).post(
            `/api/trips/${tripId}/settlements`,
          ),
          hinataCookie,
        )
          .set("Idempotency-Key", newKey())
          .send(settlementBody(preview.body.id));

        expect(response.status).toBe(500);
        expect(response.body).toMatchObject({ code: "INTERNAL_ERROR" });
        // 途中で失敗しても、精算・明細・占有・受領は残らない
        expect(await tableCounts(tripId)).toEqual(before);
      } finally {
        await failApp.close();
      }
    }
  }, 60_000);

  it("FD-10: 別の旅行の精算はお互いの札を待たない", async () => {
    const tripA = await createTrip(hinataCookie, { name: "旅行 A" });
    await createPayment(hinataCookie, tripA);
    const previewA = await createPreview(hinataCookie, tripA);
    const tripB = await createTrip(hinataCookie, { name: "旅行 B" });
    await createPayment(hinataCookie, tripB);
    const previewB = await createPreview(hinataCookie, tripB);

    // 旅行Aの札を押さえても、旅行Bの完了は待たずに通る
    const holder = await db.admin.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(
        "SELECT trip_id FROM infra.trip_finance_guards WHERE trip_id = $1 FOR UPDATE",
        [tripA],
      );
      const doneB = await postSettlement(
        hinataCookie,
        tripB,
        settlementBody(previewB.body.id),
      );
      expect(doneB.status).toBe(201);
      expect(doneB.body.sequence).toBe("1");

      // 旅行Aの要求は自分の札の行ロックでだけ待つ（本当に待っていることを確認してから放つ）
      const pendingA = postSettlement(
        hinataCookie,
        tripA,
        settlementBody(previewA.body.id),
      );
      await waitForGuardLockWaiters(1);
      await holder.query("COMMIT");
      const doneA = await pendingA;
      expect(doneA.status).toBe(201);
      expect(doneA.body.sequence).toBe("1");
    } finally {
      // すでにCOMMIT済みならROLLBACKはno-op（NOTICE）
      await holder.query("ROLLBACK");
      holder.release();
    }
  }, 30_000);

  it("FD-11: 占有の表は履歴（明細 − 取り消し）から作り直せる", async () => {
    // 作り直した占有（有効な精算の明細）と今の占有が一致することを、
    // 戻し・取り消し・取り消された対象の例外をまたぐ各段階で確かめる。
    const expectClaimsRebuilt = async (tripId: string) => {
      const actual = await db.admin.query(
        `SELECT payment_id, kind, settlement_id FROM settlement.active_claims
          WHERE trip_id = $1 ORDER BY payment_id, kind`,
        [tripId],
      );
      const rebuilt = await db.admin.query(
        `SELECT i.payment_id, i.kind, i.settlement_id
           FROM settlement.items i
          WHERE i.trip_id = $1
            AND NOT EXISTS (SELECT 1 FROM settlement.cancellations c
                              WHERE c.settlement_id = i.settlement_id)
          ORDER BY i.payment_id, i.kind`,
        [tripId],
      );
      expect(actual.rows).toEqual(rebuilt.rows);
      return actual.rows;
    };

    const tripId = await createTrip(hinataCookie);
    await createPayment(hinataCookie, tripId);
    const settledPayment = await createPayment(hinataCookie, tripId, {
      amountYen: "4001",
      payerUserId: aoi.userId,
    });
    // S1: 2件のBASEを占有
    await settle(
      hinataCookie,
      tripId,
      (await createPreview(hinataCookie, tripId)).body.id,
    );
    expect(await expectClaimsRebuilt(tripId)).toHaveLength(2);

    // 精算済みの支払いを取り消す → 戻し（REVERSAL）の対象ができる
    await cancelPayment(hinataCookie, tripId, settledPayment.body.id);
    // S2: 戻しを含む確認で精算 → REVERSALの占有が1件増える
    const reversalSettlement = await settle(
      hinataCookie,
      tripId,
      (await createPreview(hinataCookie, tripId)).body.id,
    );
    expect(await expectClaimsRebuilt(tripId)).toHaveLength(3);

    // 戻しを含む精算を取り消す → REVERSALの占有が外れる
    const cancelledReversal = await postSettlementCancel(
      hinataCookie,
      tripId,
      reversalSettlement.id,
    );
    expect(cancelledReversal.status).toBe(201);
    expect(await expectClaimsRebuilt(tripId)).toHaveLength(2);

    // S3: もう一度戻しを精算 → REVERSALの占有が戻る
    await settle(
      hinataCookie,
      tripId,
      (await createPreview(hinataCookie, tripId)).body.id,
    );
    expect(await expectClaimsRebuilt(tripId)).toHaveLength(3);

    // 取り消された対象の例外: 確認のあとに対象を取り消し、了承して完了
    const ackPayment = await createPayment(hinataCookie, tripId, {
      amountYen: "2000",
    });
    const ackPreview = await createPreview(hinataCookie, tripId);
    await cancelPayment(hinataCookie, tripId, ackPayment.body.id);
    const acked = await postSettlement(
      hinataCookie,
      tripId,
      settlementBody(ackPreview.body.id, {
        acknowledgedCancellationPaymentIds: [ackPayment.body.id],
      }),
    );
    expect(acked.status).toBe(201);

    const final = await expectClaimsRebuilt(tripId);
    expect(final).toHaveLength(4);
    // 戻しと、取り消された支払いの了承つきBASEの両方が占有に残っている
    expect(final).toContainEqual(
      expect.objectContaining({
        payment_id: settledPayment.body.id,
        kind: "REVERSAL",
      }),
    );
    expect(final).toContainEqual(
      expect.objectContaining({
        payment_id: ackPayment.body.id,
        kind: "BASE",
        settlement_id: acked.body.id,
      }),
    );
  });

  it("FD-12: 札の行ロックが 3 秒で取れなければ 503 retryable で何も残らない", async () => {
    const tripId = await createTrip(hinataCookie);
    await createPayment(hinataCookie, tripId);
    const preview = await createPreview(hinataCookie, tripId);

    const holder = await db.admin.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(
        "SELECT trip_id FROM infra.trip_finance_guards WHERE trip_id = $1 FOR UPDATE",
        [tripId],
      );

      const startedAt = Date.now();
      const response = await postSettlement(
        hinataCookie,
        tripId,
        settlementBody(preview.body.id),
      );
      const elapsed = Date.now() - startedAt;
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        code: "TEMPORARILY_UNAVAILABLE",
        retryable: true,
      });
      // 3秒のlock_timeoutまで待って諦めている
      expect(elapsed).toBeGreaterThanOrEqual(2_500);
      expect(elapsed).toBeLessThan(15_000);
      expect(await tableCounts(tripId)).toEqual({
        settlements: 0,
        items: 0,
        claims: 0,
        cancellations: 0,
        receipts: 0,
      });
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
  }, 30_000);
});

describe("認可と不在（403・404）", () => {
  it("参加しない・存在しない旅行は 4 経路すべて同じ 403", async () => {
    const foreign = await seedForeignTrip();
    const missingTrip = crypto.randomUUID();
    const someId = crypto.randomUUID();

    for (const target of [foreign.tripId, missingTrip]) {
      const complete = await postSettlement(
        hinataCookie,
        target,
        settlementBody(someId),
      );
      expect(complete.status).toBe(403);
      expect(complete.body).toMatchObject({ code: "TRIP_NOT_ACCESSIBLE" });

      const list = await listSettlements(hinataCookie, target);
      expect(list.status).toBe(403);
      expect(list.body).toMatchObject({ code: "TRIP_NOT_ACCESSIBLE" });

      const get = await getSettlement(hinataCookie, target, someId);
      expect(get.status).toBe(403);
      expect(get.body).toMatchObject({ code: "TRIP_NOT_ACCESSIBLE" });

      const cancel = await postSettlementCancel(hinataCookie, target, someId);
      expect(cancel.status).toBe(403);
      expect(cancel.body).toMatchObject({ code: "TRIP_NOT_ACCESSIBLE" });
    }
  });

  it("旅行の中に無い確認・精算は 404（無い id と別の旅行の id は同じ応答）", async () => {
    const tripId = await createTrip(hinataCookie);
    await createPayment(hinataCookie, tripId);
    const otherTrip = await createTrip(hinataCookie, { name: "別の旅行" });
    await createPayment(hinataCookie, otherTrip);
    const elsewherePreview = await createPreview(hinataCookie, otherTrip);
    const elsewhereSettlement = await settle(
      hinataCookie,
      otherTrip,
      elsewherePreview.body.id,
    );

    // 無い確認と別の旅行の確認は同じ404
    const missingPreview = await postSettlement(
      hinataCookie,
      tripId,
      settlementBody(crypto.randomUUID()),
    );
    expect(missingPreview.status).toBe(404);
    expect(missingPreview.body).toMatchObject({ code: "PREVIEW_NOT_FOUND" });
    const foreignPreview = await postSettlement(
      hinataCookie,
      tripId,
      settlementBody(elsewherePreview.body.id),
    );
    expect(foreignPreview.status).toBe(404);
    expect({ ...foreignPreview.body, requestId: null }).toEqual({
      ...missingPreview.body,
      requestId: null,
    });

    // 無い精算と別の旅行の精算は同じ404（取得・取り消しともに）
    const missingGet = await getSettlement(
      hinataCookie,
      tripId,
      crypto.randomUUID(),
    );
    expect(missingGet.status).toBe(404);
    expect(missingGet.body).toMatchObject({ code: "SETTLEMENT_NOT_FOUND" });
    const foreignGet = await getSettlement(
      hinataCookie,
      tripId,
      elsewhereSettlement.id,
    );
    expect(foreignGet.status).toBe(404);
    expect({ ...foreignGet.body, requestId: null }).toEqual({
      ...missingGet.body,
      requestId: null,
    });

    const missingCancel = await postSettlementCancel(
      hinataCookie,
      tripId,
      crypto.randomUUID(),
    );
    expect(missingCancel.status).toBe(404);
    const foreignCancel = await postSettlementCancel(
      hinataCookie,
      tripId,
      elsewhereSettlement.id,
    );
    expect(foreignCancel.status).toBe(404);
    expect({ ...foreignCancel.body, requestId: null }).toEqual({
      ...missingCancel.body,
      requestId: null,
    });
  });
});

describe("エラーに中身を出さない", () => {
  it("完了・取り消しのエラー応答に金額・用途・SQL が出ない", async () => {
    const tripId = await createTrip(hinataCookie);
    const marker = "機密用途ZXQ99";
    const markerAmount = "987654";
    const payment = await createPayment(hinataCookie, tripId, {
      amountYen: markerAmount,
      label: marker,
    });
    const preview = await createPreview(hinataCookie, tripId);
    await cancelPayment(aoiCookie, tripId, payment.body.id);

    const responses = [
      // 409（了承が要る）
      await postSettlement(
        hinataCookie,
        tripId,
        settlementBody(preview.body.id),
      ),
      // 422（完了の種類が合わない）
      await postSettlement(
        hinataCookie,
        tripId,
        settlementBody(preview.body.id, {
          completionKind: "no_transfer_required",
          acknowledgedCancellationPaymentIds: [payment.body.id],
        }),
      ),
      // 404（無い確認）
      await postSettlement(
        hinataCookie,
        tripId,
        settlementBody(crypto.randomUUID()),
      ),
      // 403（参加しない旅行）
      await postSettlement(
        hinataCookie,
        (await seedForeignTrip()).tripId,
        settlementBody(preview.body.id),
      ),
      // 404（無い精算の取り消し）
      await postSettlementCancel(hinataCookie, tripId, crypto.randomUUID()),
    ];
    for (const response of responses) {
      const body = JSON.stringify(response.body);
      expect(body).not.toContain(marker);
      expect(body).not.toContain(markerAmount);
      expect(body.toLowerCase()).not.toContain("sql");
      expect(body).not.toContain("settlement.settlements");
      expect(body).not.toContain("insert into");
      expect(body).not.toContain("SELECT");
      expect(body).not.toContain("password");
    }
    expect(responses.map((r) => r.status)).toEqual([
      409, 422, 404, 403, 404,
    ]);
  });
});
