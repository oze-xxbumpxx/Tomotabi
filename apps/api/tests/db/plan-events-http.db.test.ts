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

async function patchPlan(
  cookie: string,
  tripId: string,
  planId: string,
  body: unknown,
  ifMatch = '"1"',
): Promise<request.Response> {
  return authed(http().patch(`/api/trips/${tripId}/plans/${planId}`), cookie)
    .set("Idempotency-Key", newKey())
    .set("If-Match", ifMatch)
    .send(body);
}

async function cancelPlan(
  cookie: string,
  tripId: string,
  planId: string,
  ifMatch = '"1"',
): Promise<request.Response> {
  return authed(
    http().post(`/api/trips/${tripId}/plans/${planId}/cancel`),
    cookie,
  )
    .set("Idempotency-Key", newKey())
    .set("If-Match", ifMatch);
}

type EventKind = "achievement" | "booking";

function eventPath(kind: EventKind): string {
  return kind === "achievement" ? "achievements" : "bookings";
}

async function postEvent(
  cookie: string,
  tripId: string,
  kind: EventKind,
  planId: string,
  key = newKey(),
): Promise<request.Response> {
  return authed(http().post(`/api/trips/${tripId}/${eventPath(kind)}`), cookie)
    .set("Idempotency-Key", key)
    .send({ planId });
}

async function createEvent(
  cookie: string,
  tripId: string,
  kind: EventKind,
  planId: string,
  key = newKey(),
): Promise<request.Response> {
  const response = await postEvent(cookie, tripId, kind, planId, key);
  expect(response.status).toBe(201);
  return response;
}

async function cancelEvent(
  cookie: string,
  tripId: string,
  kind: EventKind,
  recordId: string,
  key = newKey(),
): Promise<request.Response> {
  return authed(
    http().post(`/api/trips/${tripId}/${eventPath(kind)}/${recordId}/cancel`),
    cookie,
  ).set("Idempotency-Key", key);
}

async function getPlan(
  cookie: string,
  tripId: string,
  planId: string,
): Promise<request.Response> {
  return authed(http().get(`/api/trips/${tripId}/plans/${planId}`), cookie);
}

async function activeEventIds(
  planId: string,
): Promise<{ kind: string; event_id: string }[]> {
  const result = await db.admin.query<{
    kind: string;
    event_id: string;
  }>(
    "SELECT event_kind AS kind, event_id FROM record.active_plan_events WHERE plan_id = $1 ORDER BY event_kind",
    [planId],
  );
  return result.rows;
}

async function planEventCount(planId: string): Promise<number> {
  const result = await db.admin.query<{ c: string }>(
    "SELECT count(*)::text AS c FROM record.plan_events WHERE plan_id = $1",
    [planId],
  );
  return Number(result.rows[0]!.c);
}

async function cancellationCount(eventId: string): Promise<number> {
  const result = await db.admin.query<{ c: string }>(
    "SELECT count(*)::text AS c FROM record.plan_event_cancellations WHERE event_id = $1",
    [eventId],
  );
  return Number(result.rows[0]!.c);
}

async function planRow(
  planId: string,
): Promise<{ kind: string; cancelled_at: string | null }> {
  const result = await db.admin.query<{
    kind: string;
    cancelled_at: string | null;
  }>(
    "SELECT kind, cancelled_at::text AS cancelled_at FROM planning.plans WHERE id = $1",
    [planId],
  );
  return result.rows[0]!;
}

/** ひなたが参加しない旅行を別利用者2人で直接作る。 */
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

/**
 * 予定行のロックで待っている接続が現れるまでpg_stat_activityを見る
 * （時間待ちにしない。R-3）。FOR NO KEY UPDATEの待ちはtupleではなく
 * transactionidの待ちイベントとして現れる。app_runtimeの
 * statement_timeoutは5sなので、待ちを検出したら速やかにCOMMITする。
 */
async function waitForPlanLockWaiters(
  count: number,
  timeoutMs = 3_000,
): Promise<void> {
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
    if (Number(result.rows[0]!.c) >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for the plan row lock waiters");
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

const FOOD_PLAN = { name: "昼食", kind: "food", date: "2026-09-11" };
const PLACE_PLAN = { name: "清水寺", kind: "place", date: "2026-09-11" };
const LODGING_PLAN = { name: "旅館", kind: "lodging", date: "2026-09-11" };

describe("達成・予約を付ける（RD-02、RD-03）", () => {
  it("RD-02: 食べ処の予定に達成と予約を1件ずつ付けられる", async () => {
    const tripId = await createTrip(hinataCookie);
    const planId = await createPlan(hinataCookie, tripId, FOOD_PLAN);

    const achievement = await createEvent(
      hinataCookie,
      tripId,
      "achievement",
      planId,
    );
    expect(achievement.body).toMatchObject({
      tripId,
      planId,
      kind: "achievement",
      createdBy: hinata.userId,
      cancellation: null,
    });
    const booking = await createEvent(hinataCookie, tripId, "booking", planId);
    expect(booking.body).toMatchObject({
      tripId,
      planId,
      kind: "booking",
      createdBy: hinata.userId,
      cancellation: null,
    });

    const actives = await activeEventIds(planId);
    expect(actives).toEqual([
      { kind: "achievement", event_id: achievement.body.id },
      { kind: "booking", event_id: booking.body.id },
    ]);

    // 予定の詳細でも有効な達成・予約が見える
    const plan = await getPlan(hinataCookie, tripId, planId);
    expect(plan.body.achievement.id).toBe(achievement.body.id);
    expect(plan.body.booking.id).toBe(booking.body.id);
  });

  it("RD-02: 取りやめた宿の予定に予約を付けられる", async () => {
    const tripId = await createTrip(hinataCookie);
    const planId = await createPlan(hinataCookie, tripId, LODGING_PLAN);
    const cancelled = await cancelPlan(hinataCookie, tripId, planId);
    expect(cancelled.status).toBe(200);

    const booking = await createEvent(hinataCookie, tripId, "booking", planId);
    expect(booking.body.kind).toBe("booking");
    const actives = await activeEventIds(planId);
    expect(actives).toEqual([
      { kind: "booking", event_id: booking.body.id },
    ]);
  });

  it("RD-03: 取りやめた予定への達成は409 PLAN_CANCELLED、種類に合わない記録は409 PLAN_KIND_NOT_SUPPORTED", async () => {
    const tripId = await createTrip(hinataCookie);
    const lodgingId = await createPlan(hinataCookie, tripId, LODGING_PLAN);
    const placeId = await createPlan(hinataCookie, tripId, PLACE_PLAN);
    const cancelled = await cancelPlan(hinataCookie, tripId, placeId);
    expect(cancelled.status).toBe(200);

    // 達成は宿・移動に付けられない
    const onLodging = await postEvent(
      hinataCookie,
      tripId,
      "achievement",
      lodgingId,
    );
    expect(onLodging.status).toBe(409);
    expect(onLodging.body).toMatchObject({ code: "PLAN_KIND_NOT_SUPPORTED" });

    // 取りやめた予定に達成は付けられない
    const onCancelled = await postEvent(
      hinataCookie,
      tripId,
      "achievement",
      placeId,
    );
    expect(onCancelled.status).toBe(409);
    expect(onCancelled.body).toMatchObject({ code: "PLAN_CANCELLED" });

    // 予約は場所・買い物に付けられない
    const bookingOnPlace = await postEvent(
      hinataCookie,
      tripId,
      "booking",
      placeId,
    );
    expect(bookingOnPlace.status).toBe(409);
    expect(bookingOnPlace.body).toMatchObject({
      code: "PLAN_KIND_NOT_SUPPORTED",
    });

    expect(await planEventCount(placeId)).toBe(0);
    expect(await planEventCount(lodgingId)).toBe(0);
  });
});

describe("競合と取り消し（RD-04〜RD-06）", () => {
  it("RD-04: 有効な記録がある予定への付けは409 RECORD_ALREADY_ACTIVEでexistingRecordIdを返す", async () => {
    const tripId = await createTrip(hinataCookie);
    const planId = await createPlan(hinataCookie, tripId, PLACE_PLAN);
    const first = await createEvent(hinataCookie, tripId, "achievement", planId);

    const again = await postEvent(
      aoiCookie,
      tripId,
      "achievement",
      planId,
    );
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({
      code: "RECORD_ALREADY_ACTIVE",
      existingRecordId: first.body.id,
    });

    // 種類が違う記録なら同じ予定に付けられる（買い物は予約不可なので食べ処で確認）
    const foodId = await createPlan(hinataCookie, tripId, FOOD_PLAN);
    await createEvent(hinataCookie, tripId, "achievement", foodId);
    const booking = await postEvent(aoiCookie, tripId, "booking", foodId);
    expect(booking.status).toBe(201);
  });

  it("RD-05: 取り消すと元の記録は残り占有行だけ消える。付け直しは別の記録になる", async () => {
    const tripId = await createTrip(hinataCookie);
    const planId = await createPlan(hinataCookie, tripId, PLACE_PLAN);
    const event = await createEvent(hinataCookie, tripId, "achievement", planId);

    const cancelled = await cancelEvent(
      aoiCookie,
      tripId,
      "achievement",
      event.body.id,
    );
    expect(cancelled.status).toBe(201);
    expect(cancelled.body).toMatchObject({
      targetId: event.body.id,
      cancelledBy: aoi.userId,
    });

    // 元の記録の行は残り、占有行だけが消える
    expect(await planEventCount(planId)).toBe(1);
    expect(await activeEventIds(planId)).toEqual([]);

    const renewed = await createEvent(
      hinataCookie,
      tripId,
      "achievement",
      planId,
    );
    expect(renewed.body.id).not.toBe(event.body.id);
    expect(await activeEventIds(planId)).toEqual([
      { kind: "achievement", event_id: renewed.body.id },
    ]);
    expect(await planEventCount(planId)).toBe(2);
  });

  it("RD-06: 付け直したあと古い取り消しを再送しても新しい記録は消えない", async () => {
    const tripId = await createTrip(hinataCookie);
    const planId = await createPlan(hinataCookie, tripId, PLACE_PLAN);
    const first = await createEvent(hinataCookie, tripId, "achievement", planId);

    const cancelKey = newKey();
    const cancelled = await cancelEvent(
      hinataCookie,
      tripId,
      "achievement",
      first.body.id,
      cancelKey,
    );
    expect(cancelled.status).toBe(201);

    const renewed = await createEvent(
      hinataCookie,
      tripId,
      "achievement",
      planId,
    );

    // 同じキーの取り消しの再送は保存した結果を返し、新しい記録に触れない
    const resent = await cancelEvent(
      hinataCookie,
      tripId,
      "achievement",
      first.body.id,
      cancelKey,
    );
    expect(resent.status).toBe(201);
    expect(resent.body).toMatchObject({ targetId: first.body.id });

    // 別キーの再取り消しも今ある取り消しを返すだけで、新しい記録を消さない
    const otherKey = await cancelEvent(
      aoiCookie,
      tripId,
      "achievement",
      first.body.id,
    );
    expect(otherKey.status).toBe(200);
    expect(otherKey.body).toMatchObject({ targetId: first.body.id });

    expect(await activeEventIds(planId)).toEqual([
      { kind: "achievement", event_id: renewed.body.id },
    ]);
    expect(await cancellationCount(first.body.id)).toBe(1);
  });
});

describe("受領と履歴の決まり（RD-07）", () => {
  it("RD-07: 一度でも記録があれば種類は変えられない（取り消した記録も含む）", async () => {
    const tripId = await createTrip(hinataCookie);
    const planId = await createPlan(hinataCookie, tripId, PLACE_PLAN);
    const event = await createEvent(hinataCookie, tripId, "achievement", planId);
    await cancelEvent(hinataCookie, tripId, "achievement", event.body.id);

    const patch = await patchPlan(hinataCookie, tripId, planId, {
      kind: "food",
    });
    expect(patch.status).toBe(409);
    expect(patch.body).toMatchObject({ code: "PLAN_HAS_RECORD_HISTORY" });
  });

  it("RD-07: 同じキーで別の内容を送ると409 IDEMPOTENCY_KEY_REUSED", async () => {
    const tripId = await createTrip(hinataCookie);
    const planId = await createPlan(hinataCookie, tripId, PLACE_PLAN);
    const otherPlanId = await createPlan(hinataCookie, tripId, PLACE_PLAN);
    const key = newKey();

    const first = await postEvent(hinataCookie, tripId, "achievement", planId, key);
    expect(first.status).toBe(201);

    const reused = await postEvent(
      hinataCookie,
      tripId,
      "achievement",
      otherPlanId,
      key,
    );
    expect(reused.status).toBe(409);
    expect(reused.body).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    // 取り消しも同じキー・別の記録で409
    const cancelKey = newKey();
    const cancelled = await cancelEvent(
      hinataCookie,
      tripId,
      "achievement",
      first.body.id,
      cancelKey,
    );
    expect(cancelled.status).toBe(201);
    const reusedCancel = await cancelEvent(
      hinataCookie,
      tripId,
      "achievement",
      "55555555-5555-4555-8555-555555555555",
      cancelKey,
    );
    expect(reusedCancel.status).toBe(409);
    expect(reusedCancel.body).toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  });
});

describe("ガードと参照の絞り込み", () => {
  it("参加していない旅行・認証なし・Idempotency-Key欠落・形式違反は弾く", async () => {
    const tripId = await createTrip(hinataCookie);
    const planId = await createPlan(hinataCookie, tripId, PLACE_PLAN);
    const foreignTripId = await seedForeignTrip();

    // 参加していない旅行（存在しない旅行と同じ403）
    const foreign = await postEvent(
      hinataCookie,
      foreignTripId,
      "achievement",
      planId,
    );
    expect(foreign.status).toBe(403);
    expect(foreign.body).toMatchObject({ code: "TRIP_NOT_ACCESSIBLE" });

    // 認証なし
    const anonymous = await http()
      .post(`/api/trips/${tripId}/achievements`)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", newKey())
      .send({ planId });
    expect(anonymous.status).toBe(401);

    // Idempotency-Key欠落・UUIDでない
    const noKey = await authed(
      http().post(`/api/trips/${tripId}/achievements`),
      hinataCookie,
    ).send({ planId });
    expect(noKey.status).toBe(400);
    expect(noKey.body).toMatchObject({ code: "INVALID_REQUEST" });
    const badKey = await authed(
      http().post(`/api/trips/${tripId}/achievements`),
      hinataCookie,
    )
      .set("Idempotency-Key", "not-a-uuid")
      .send({ planId });
    expect(badKey.status).toBe(400);

    // 旅行の中に無い予定・形式違反の予定id
    const missingPlan = await postEvent(
      hinataCookie,
      tripId,
      "achievement",
      "55555555-5555-4555-8555-555555555555",
    );
    expect(missingPlan.status).toBe(404);
    expect(missingPlan.body).toMatchObject({ code: "PLAN_NOT_FOUND" });
    const badPlanId = await postEvent(
      hinataCookie,
      tripId,
      "achievement",
      "not-a-uuid",
    );
    expect(badPlanId.status).toBe(400);
    // body自体が違う形
    const badBody = await authed(
      http().post(`/api/trips/${tripId}/achievements`),
      hinataCookie,
    )
      .set("Idempotency-Key", newKey())
      .send({});
    expect(badBody.status).toBe(400);
  });

  it("取り消しはURLの種類と記録の種類が違う・別の旅行・無い記録で404 RECORD_NOT_FOUND", async () => {
    const tripId = await createTrip(hinataCookie);
    const planId = await createPlan(hinataCookie, tripId, PLACE_PLAN);
    const event = await createEvent(hinataCookie, tripId, "achievement", planId);
    const foreignTripId = await seedForeignTrip();

    // URLはachievementsだが対象がbooking側の記録でも同じ404にそろう。
    // ここでは「URLの種類と違う記録」として、予約記録をachievementのURLで取り消す。
    const foodId = await createPlan(hinataCookie, tripId, FOOD_PLAN);
    const booking = await createEvent(hinataCookie, tripId, "booking", foodId);
    const mismatched = await cancelEvent(
      hinataCookie,
      tripId,
      "achievement",
      booking.body.id,
    );
    expect(mismatched.status).toBe(404);
    expect(mismatched.body).toMatchObject({ code: "RECORD_NOT_FOUND" });

    // 無い記録
    const missing = await cancelEvent(
      hinataCookie,
      tripId,
      "achievement",
      "55555555-5555-4555-8555-555555555555",
    );
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: "RECORD_NOT_FOUND" });

    // 別の旅行の記録（旅行の中の記録として見えない）
    const foreignPlanId = await db.admin.query<{ id: string }>(
      "INSERT INTO planning.plans (trip_id, name, kind, planned_date) VALUES ($1, '別の予定', 'place', '2026-10-01') RETURNING id",
      [foreignTripId],
    );
    const foreignEvent = await db.admin.query<{ id: string }>(
      `INSERT INTO record.plan_events (trip_id, plan_id, event_kind, created_by)
       SELECT $1, $2, 'achievement', user_id FROM planning.trip_participants
        WHERE trip_id = $1 ORDER BY slot LIMIT 1
       RETURNING id`,
      [foreignTripId, foreignPlanId.rows[0]!.id],
    );
    const foreign = await cancelEvent(
      hinataCookie,
      tripId,
      "achievement",
      foreignEvent.rows[0]!.id,
    );
    expect(foreign.status).toBe(404);
    expect(foreign.body).toMatchObject({ code: "RECORD_NOT_FOUND" });

    // 同じ旅行の正しい記録は取り消せる
    const own = await cancelEvent(
      hinataCookie,
      tripId,
      "achievement",
      event.body.id,
    );
    expect(own.status).toBe(201);
  });
});

describe("同時実行（RD-08、RD-09）", () => {
  it("RD-08: 種類の変更と達成を2つの接続で同時に送っても、決まりに反する状態はできない", async () => {
    const tripId = await createTrip(hinataCookie);
    const planId = await createPlan(hinataCookie, tripId, FOOD_PLAN);

    // 接続A（管理接続）: 予定行をFOR NO KEY UPDATEで持つ。
    // 2つのAPI要求はこのロックで待ち、COMMIT後に直列化されて進む。
    const holder = await db.admin.connect();
    let committed = false;
    try {
      await holder.query("BEGIN");
      await holder.query(
        "SELECT id FROM planning.plans WHERE id = $1 FOR NO KEY UPDATE",
        [planId],
      );

      const patchPromise = patchPlan(hinataCookie, tripId, planId, {
        kind: "lodging",
      });
      const eventPromise = postEvent(
        hinataCookie,
        tripId,
        "achievement",
        planId,
      );
      // 両方の要求が予定行のロックで待っていることを確かめてから進める
      await waitForPlanLockWaiters(2);
      await holder.query("COMMIT");
      committed = true;

      const [patch, event] = await Promise.all([patchPromise, eventPromise]);
      const plan = await planRow(planId);
      const actives = await activeEventIds(planId);

      if (event.status === 201) {
        // 達成が先に成立: 種類変更は履歴があるため409
        expect(patch.status).toBe(409);
        expect(patch.body).toMatchObject({ code: "PLAN_HAS_RECORD_HISTORY" });
        expect(plan.kind).toBe("food");
        expect(actives).toEqual([
          { kind: "achievement", event_id: event.body.id },
        ]);
      } else {
        // 種類変更が先に成立: 宿への達成は409
        expect(patch.status).toBe(200);
        expect(event.status).toBe(409);
        expect(event.body).toMatchObject({
          code: "PLAN_KIND_NOT_SUPPORTED",
        });
        expect(plan.kind).toBe("lodging");
        expect(actives).toEqual([]);
      }
    } finally {
      if (!committed) {
        await holder.query("ROLLBACK").catch(() => {});
      }
      holder.release();
    }
  });

  it("RD-09: 取りやめと達成を2つの接続で同時に送っても、取りやめた予定にあとから達成は付かない", async () => {
    const tripId = await createTrip(hinataCookie);
    const planId = await createPlan(hinataCookie, tripId, PLACE_PLAN);

    const holder = await db.admin.connect();
    let committed = false;
    try {
      await holder.query("BEGIN");
      await holder.query(
        "SELECT id FROM planning.plans WHERE id = $1 FOR NO KEY UPDATE",
        [planId],
      );

      const cancelPromise = cancelPlan(hinataCookie, tripId, planId);
      const eventPromise = postEvent(
        hinataCookie,
        tripId,
        "achievement",
        planId,
      );
      await waitForPlanLockWaiters(2);
      await holder.query("COMMIT");
      committed = true;

      const [cancel, event] = await Promise.all([cancelPromise, eventPromise]);
      const plan = await planRow(planId);
      const actives = await activeEventIds(planId);

      // 予定の取りやめは必ず成立する（記録があっても自動では取り消さない）
      expect(cancel.status).toBe(200);
      if (event.status === 201) {
        // 達成が先に成立: 取りやめた予定に達成が残るのは許容される状態
        expect(plan.cancelled_at).not.toBeNull();
        expect(actives).toEqual([
          { kind: "achievement", event_id: event.body.id },
        ]);
      } else {
        // 取りやめが先に成立: あとから達成は付かない
        expect(event.status).toBe(409);
        expect(event.body).toMatchObject({ code: "PLAN_CANCELLED" });
        expect(plan.cancelled_at).not.toBeNull();
        expect(actives).toEqual([]);
      }
    } finally {
      if (!committed) {
        await holder.query("ROLLBACK").catch(() => {});
      }
      holder.release();
    }
  });
});
