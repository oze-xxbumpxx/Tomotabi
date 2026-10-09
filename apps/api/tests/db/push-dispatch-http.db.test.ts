import { createECDH, createHash, randomBytes, randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import type { Auth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import type { TestHelpers } from "better-auth/plugins";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AFTER_RESPONSE } from "../../src/adapter/after-response/after-response";
import type { AfterResponse } from "../../src/adapter/after-response/after-response";
import { closePool, getPool } from "../../src/infrastructure/database/pool";
import { createAuth } from "../../src/modules/identity/infrastructure/better-auth";
import { DISPATCH_LOG } from "../../src/modules/notification/adapter/outbound/dispatch-log.port";
import type {
  DispatchLog,
  DispatchLogEntry,
} from "../../src/modules/notification/adapter/outbound/dispatch-log.port";
import { PUSH_TRANSPORT } from "../../src/modules/notification/adapter/outbound/push-transport";
import type {
  PushRequestDetails,
  PushTransport,
} from "../../src/modules/notification/adapter/outbound/push-transport";
import {
  createRoles,
  migrateAsMigrator,
  startPostgres,
  type TestDatabase,
} from "../support/database";
import { createHttpTestApp } from "../support/nest-app";

const ORIGIN = "http://localhost:3000";

const vapidCurrent = createECDH("prime256v1");
vapidCurrent.generateKeys();
const VAPID_KEYS_JSON = JSON.stringify([
  {
    keyId: "current-key",
    state: "current",
    publicKey: vapidCurrent.getPublicKey().toString("base64url"),
    privateKey: vapidCurrent.getPrivateKey().toString("base64url"),
  },
  { keyId: "revoked-key", state: "revoked" },
]);

const TEST_ENV: Record<string, string> = {
  DATABASE_URL: "",
  PUBLIC_APP_ORIGIN: ORIGIN,
  BETTER_AUTH_SECRET: "test-secret-for-db-tests-only",
  GOOGLE_CLIENT_ID: "test-google-client-id",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
  VAPID_KEYS: VAPID_KEYS_JSON,
  VAPID_SUBJECT: "mailto:tomotabi-test@example.test",
};

/** 届け先を数えるだけの偽物の送る部品（実際には外へ出ない）。 */
class RecordingTransport implements PushTransport {
  calls: PushRequestDetails[] = [];
  status = 201;
  throwError: string | null = null;
  async send(request: PushRequestDetails): Promise<{ status: number }> {
    this.calls.push(request);
    if (this.throwError !== null) {
      throw new Error(`send failed to ${request.endpoint}`);
    }
    return { status: this.status };
  }
}

/** 使いどころに流す記録を取る偽物の記録口。 */
class RecordingLog implements DispatchLog {
  entries: DispatchLogEntry[] = [];
  info(entry: DispatchLogEntry): void {
    this.entries.push(entry);
  }
  warn(entry: DispatchLogEntry): void {
    this.entries.push(entry);
  }
}

const transport = new RecordingTransport();
const dispatchLog = new RecordingLog();

let db: TestDatabase;
let app: NestExpressApplication;
let moduleRef: TestingModule;
let auth: Auth;
let testHelpers: TestHelpers;
let afterResponse: AfterResponse;
let nextSlot = 0;

function http() {
  return request(app.getHttpServer());
}

function authed(req: request.Test, cookie: string): request.Test {
  return req
    .set("Cookie", cookie)
    .set("Origin", ORIGIN)
    .set("Content-Type", "application/json");
}

const newKey = () => randomUUID();

async function newUser(name: string): Promise<{
  userId: string;
  cookie: string;
}> {
  const result = await db.admin.query<{ id: string }>(
    "INSERT INTO identity.users (name, email, email_verified) VALUES ($1, $2, TRUE) RETURNING id",
    [name, `${name}-${randomUUID()}@example.test`],
  );
  const userId = result.rows[0]!.id;
  const sub = `test-sub-${randomUUID()}`;
  await db.admin.query(
    "INSERT INTO identity.accounts (account_id, provider_id, user_id) VALUES ($1, 'google', $2)",
    [sub, userId],
  );
  await db.admin.query(
    `INSERT INTO identity.allowed_google_accounts (slot, user_id, google_sub, enabled)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (slot) DO UPDATE SET user_id = $2, google_sub = $3, enabled = TRUE`,
    [nextSlot++ % 2, userId, sub],
  );
  const login = await testHelpers.login({ userId });
  const cookie = login.headers.get("cookie");
  if (cookie === null) {
    throw new Error("login did not produce a cookie header");
  }
  return { userId, cookie };
}

const TRIP_BODY = {
  name: "京都の旅",
  startsOn: "2026-09-10",
  endsOn: "2026-09-12",
};

async function createTrip(cookie: string): Promise<string> {
  const response = await authed(http().post("/api/trips"), cookie)
    .set("Idempotency-Key", newKey())
    .send(TRIP_BODY);
  expect(response.status).toBe(201);
  return response.body.id as string;
}

type SeededSub = {
  endpoint: string;
  sessionId: string;
  vapidKeyId: string;
  enabled: boolean;
  expirationTime: Date | null;
};

function newEndpoint(tag = "sub"): string {
  return `https://fcm.googleapis.com/fcm/send/${tag}-${randomUUID()}`;
}

async function seedSub(
  userId: string,
  overrides: Partial<SeededSub> = {},
): Promise<{ id: string; endpoint: string }> {
  const sub: SeededSub = {
    endpoint: newEndpoint("seeded"),
    sessionId: `seeded-session-${randomUUID()}`,
    vapidKeyId: "current-key",
    enabled: true,
    expirationTime: null,
    ...overrides,
  };
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const id = randomUUID();
  await db.admin.query(
    `INSERT INTO notification.push_subscriptions
       (id, user_id, endpoint, endpoint_hash, p256dh, auth_secret,
        expiration_time, registration_session_id, device_label, vapid_key_id, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '種した端末', $9, $10)`,
    [
      id,
      userId,
      sub.endpoint,
      createHash("sha256").update(sub.endpoint, "utf8").digest(),
      ecdh.getPublicKey(),
      randomBytes(16),
      sub.expirationTime,
      sub.sessionId,
      sub.vapidKeyId,
      sub.enabled,
    ],
  );
  return { id, endpoint: sub.endpoint };
}

async function subEnabled(id: string): Promise<boolean | null> {
  const result = await db.admin.query<{ enabled: boolean }>(
    "SELECT enabled FROM notification.push_subscriptions WHERE id = $1",
    [id],
  );
  return result.rows[0]?.enabled ?? null;
}

async function latestSessionId(userId: string): Promise<string> {
  const result = await db.admin.query<{ id: string }>(
    `SELECT id FROM identity.sessions WHERE user_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  return result.rows[0]!.id;
}

const PLAN_BODY = {
  name: "清水寺",
  kind: "place",
  date: "2026-09-11",
};

async function postPlan(
  cookie: string,
  tripId: string,
  key = newKey(),
  body: Record<string, unknown> = PLAN_BODY,
): Promise<request.Response> {
  return authed(http().post(`/api/trips/${tripId}/plans`), cookie)
    .set("Idempotency-Key", key)
    .send(body);
}

async function createPlan(
  cookie: string,
  tripId: string,
  body: Record<string, unknown> = PLAN_BODY,
): Promise<string> {
  const response = await postPlan(cookie, tripId, newKey(), body);
  expect(response.status).toBe(201);
  return response.body.id as string;
}

async function triggerPlanAdded(cookie: string, tripId: string): Promise<void> {
  const response = await postPlan(cookie, tripId);
  expect(response.status).toBe(201);
  await afterResponse.drain();
}

// ---- 準備 ----

beforeAll(async () => {
  db = await startPostgres();
  await createRoles(db);
  await migrateAsMigrator(db);

  TEST_ENV.DATABASE_URL = db.urlFor("app_runtime");
  for (const [key, value] of Object.entries(TEST_ENV)) {
    process.env[key] = value;
  }

  const runtimePool = getPool();
  for (const pool of [runtimePool, db.admin]) {
    pool.on("error", () => {});
  }
  auth = createAuth(
    {
      baseURL: ORIGIN,
      secret: TEST_ENV.BETTER_AUTH_SECRET,
      googleClientId: TEST_ENV.GOOGLE_CLIENT_ID,
      googleClientSecret: TEST_ENV.GOOGLE_CLIENT_SECRET,
      useSecureCookies: false,
    },
    runtimePool,
    { plugins: [testUtils()] },
  );
  testHelpers = ((await auth.$context) as unknown as { test: TestHelpers })
    .test;

  moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PUSH_TRANSPORT)
    .useValue(transport)
    .overrideProvider(DISPATCH_LOG)
    .useValue(dispatchLog)
    .compile();

  app = await createHttpTestApp(moduleRef, auth);
  afterResponse = moduleRef.get<AfterResponse>(AFTER_RESPONSE);
});

beforeEach(() => {
  transport.calls = [];
  transport.status = 201;
  transport.throwError = null;
  dispatchLog.entries = [];
});

afterAll(async () => {
  await app?.close();
  await closePool();
  await db?.stop();
  for (const key of Object.keys(TEST_ENV)) {
    delete process.env[key];
  }
});

// ---- 試験 ----

describe("届ける相手の選び方（PD-15）", () => {
  it("同じ旅行の相方の、有効な購読だけへ送る", async () => {
    const actor = await newUser("actor");
    const partner = await newUser("partner");
    const tripId = await createTrip(actor.cookie);

    const good = await seedSub(partner.userId);
    // 無効・期限切れ・閉じた画面・失効した鍵・相手以外（自分自身）の購読。
    await seedSub(partner.userId, { enabled: false });
    await seedSub(partner.userId, { expirationTime: new Date("2020-01-01") });
    const partnerSession = await latestSessionId(partner.userId);
    await seedSub(partner.userId, { sessionId: partnerSession });
    await db.admin.query(
      `INSERT INTO notification.closed_push_sessions (session_id, user_id, closed_at)
       VALUES ($1, $2, NOW())`,
      [partnerSession, partner.userId],
    );
    await seedSub(partner.userId, { vapidKeyId: "revoked-key" });
    await seedSub(partner.userId, { vapidKeyId: "no-such-key" });
    await seedSub(actor.userId); // 操作した人自身

    await triggerPlanAdded(actor.cookie, tripId);

    // 有効な購読（good）1件だけへ送る。
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.endpoint).toBe(good.endpoint);
  });

  it("利用の許可を外された相方には送らない", async () => {
    const actor = await newUser("actor2");
    const partner = await newUser("partner2");
    const tripId = await createTrip(actor.cookie);
    await seedSub(partner.userId);
    // 相方の利用許可を外す。
    await db.admin.query(
      "UPDATE identity.allowed_google_accounts SET enabled = FALSE WHERE user_id = $1",
      [partner.userId],
    );

    await triggerPlanAdded(actor.cookie, tripId);
    expect(transport.calls).toHaveLength(0);
  });
});

describe("11種の操作の届け先（PD-16）", () => {
  it("届く11の操作それぞれで相方へちょうど1回送る", async () => {
    const actor = await newUser("actor3");
    const partner = await newUser("partner3");
    const tripId = await createTrip(actor.cookie);
    const sub = await seedSub(partner.userId);

    let expected = 0;
    const expectSent = async (label: string) => {
      await afterResponse.drain();
      expected += 1;
      expect(transport.calls.length, label).toBe(expected);
      expect(transport.calls.at(-1)?.endpoint).toBe(sub.endpoint);
    };

    // 1) 予定の追加
    const planId = await createPlan(actor.cookie, tripId);
    await expectSent("plan_added");
    // 2) 予定の日の移動
    const moved = await authed(
      http().post(`/api/trips/${tripId}/plans/${planId}/move`),
      actor.cookie,
    )
      .set("Idempotency-Key", newKey())
      .set("If-Match", '"1"')
      .send({ date: "2026-09-12" });
    expect(moved.status).toBe(200);
    await expectSent("plan_moved");
    // 3) 達成を記録（別の予定で。予定の追加分も1回送られる）
    const planA = await createPlan(actor.cookie, tripId);
    await expectSent("plan_added(2件目)");
    const ach = await authed(
      http().post(`/api/trips/${tripId}/achievements`),
      actor.cookie,
    )
      .set("Idempotency-Key", newKey())
      .send({ planId: planA });
    expect(ach.status).toBe(201);
    await expectSent("achievement_added");
    // 4) 予約済みを記録（別の予定で。予約はfood/lodging/transportの予定にだけ付く）
    const planB = await createPlan(actor.cookie, tripId, {
      name: "旅館",
      kind: "lodging",
      date: "2026-09-11",
    });
    await expectSent("plan_added(3件目)");
    const book = await authed(
      http().post(`/api/trips/${tripId}/bookings`),
      actor.cookie,
    )
      .set("Idempotency-Key", newKey())
      .send({ planId: planB });
    expect(book.status).toBe(201);
    await expectSent("booking_added");
    // 5) 達成の記録を取り消し
    const achId = ach.body.id as string;
    const achCancel = await authed(
      http().post(`/api/trips/${tripId}/achievements/${achId}/cancel`),
      actor.cookie,
    ).set("Idempotency-Key", newKey());
    expect(achCancel.status).toBe(201);
    await expectSent("achievement_cancelled");
    // 6) 予約済みの記録を取り消し
    const bookId = book.body.id as string;
    const bookCancel = await authed(
      http().post(`/api/trips/${tripId}/bookings/${bookId}/cancel`),
      actor.cookie,
    ).set("Idempotency-Key", newKey());
    expect(bookCancel.status).toBe(201);
    await expectSent("booking_cancelled");
    // 7) 支払いを記録
    const payment = await authed(
      http().post(`/api/trips/${tripId}/payments`),
      actor.cookie,
    )
      .set("Idempotency-Key", newKey())
      .send({
        amountYen: "7001",
        payerUserId: actor.userId,
        allocations: [
          { userId: actor.userId, percent: 50 },
          { userId: partner.userId, percent: 50 },
        ],
      });
    expect(payment.status).toBe(201);
    await expectSent("payment_added");
    // 8) 支払いの記録を取り消し
    const payId = payment.body.id as string;
    const payCancel = await authed(
      http().post(`/api/trips/${tripId}/payments/${payId}/cancel`),
      actor.cookie,
    ).set("Idempotency-Key", newKey());
    expect(payCancel.status).toBe(201);
    await expectSent("payment_cancelled");
    // 9) 精算を記録（確認 → 精算。有効な支払いが残っていないと確認は422なので、
    //    精算用にもう1件支払いを作る）
    const settlePayment = await authed(
      http().post(`/api/trips/${tripId}/payments`),
      actor.cookie,
    )
      .set("Idempotency-Key", newKey())
      .send({
        amountYen: "3000",
        payerUserId: actor.userId,
        allocations: [
          { userId: actor.userId, percent: 50 },
          { userId: partner.userId, percent: 50 },
        ],
      });
    expect(settlePayment.status).toBe(201);
    await expectSent("payment_added(2件目)");
    const preview = await authed(
      http().post(`/api/trips/${tripId}/settlement-previews`),
      actor.cookie,
    ).set("Idempotency-Key", newKey());
    expect(preview.status).toBe(201);
    const settle = await authed(
      http().post(`/api/trips/${tripId}/settlements`),
      actor.cookie,
    )
      .set("Idempotency-Key", newKey())
      .send({
        previewId: preview.body.id,
        completionKind: "transfer_completed",
        // 取り消した支払いは確認の一覧に載らない（確認の前に取り消したため）。
        acknowledgedCancellationPaymentIds: [],
      });
    expect(settle.status).toBe(201);
    await expectSent("settlement_completed");
    // 10) 精算の取り消し
    const settleId = settle.body.id as string;
    const settleCancel = await authed(
      http().post(`/api/trips/${tripId}/settlements/${settleId}/cancel`),
      actor.cookie,
    ).set("Idempotency-Key", newKey());
    expect(settleCancel.status).toBe(201);
    await expectSent("settlement_cancelled");
    // 11) 予定の取りやめ
    const planC = await createPlan(actor.cookie, tripId);
    await expectSent("plan_added(4件目)");
    const cancel = await authed(
      http().post(`/api/trips/${tripId}/plans/${planC}/cancel`),
      actor.cookie,
    )
      .set("Idempotency-Key", newKey())
      .set("If-Match", '"1"');
    expect(cancel.status).toBe(200);
    await expectSent("plan_cancelled");
  });

  it("届かない操作（再送・二度目の取り消し・名前の編集・旅行の開始/終了）では送らない", async () => {
    const actor = await newUser("actor4");
    const partner = await newUser("partner4");
    const tripId = await createTrip(actor.cookie);
    await seedSub(partner.userId);

    const key = newKey();
    const first = await postPlan(actor.cookie, tripId, key);
    expect(first.status).toBe(201);
    const planId = first.body.id as string;

    // 同じキーの再送 → 保存は同じ結果、通知は送らない
    const replay = await postPlan(actor.cookie, tripId, key);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(planId);
    // 名前・メモの編集（届かない操作）
    const renamed = await authed(
      http().patch(`/api/trips/${tripId}/plans/${planId}`),
      actor.cookie,
    )
      .set("Idempotency-Key", newKey())
      .set("If-Match", '"1"')
      .send({ name: "銀閣寺", memo: "メモ" });
    expect(renamed.status).toBe(200);
    // 予定を取りやめる → 二度目の取りやめは届かない
    const cancel = await authed(
      http().post(`/api/trips/${tripId}/plans/${planId}/cancel`),
      actor.cookie,
    )
      .set("Idempotency-Key", newKey())
      .set("If-Match", '"2"');
    expect([200, 409]).toContain(cancel.status);
    const cancelAgain = await authed(
      http().post(`/api/trips/${tripId}/plans/${planId}/cancel`),
      actor.cookie,
    )
      .set("Idempotency-Key", newKey())
      .set("If-Match", '"3"');
    expect([200, 409]).toContain(cancelAgain.status);

    await afterResponse.drain();
    // 届くのは「予定の追加」1回だけ（取りやめ成功時は+1）。
    const expectedCount = cancel.status === 200 ? 2 : 1;
    expect(transport.calls.length).toBe(expectedCount);

    // 旅行の開始・終了は届かない操作
    transport.calls = [];
    const started = await authed(
      http().post(`/api/trips/${tripId}/start`),
      actor.cookie,
    )
      .set("Idempotency-Key", newKey())
      .set("If-Match", '"1"');
    expect([200, 201]).toContain(started.status);
    const finished = await authed(
      http().post(`/api/trips/${tripId}/finish`),
      actor.cookie,
    )
      .set("Idempotency-Key", newKey())
      .set("If-Match", started.headers.etag ?? '"2"');
    expect([200, 201]).toContain(finished.status);
    await afterResponse.drain();
    expect(transport.calls.length).toBe(0);
  });
});

describe("送り損ねても保存は終わる（PD-17）", () => {
  it("送信が全部失敗しても、予定の保存は201で行も残る", async () => {
    const actor = await newUser("actor5");
    const partner = await newUser("partner5");
    const tripId = await createTrip(actor.cookie);
    await seedSub(partner.userId);

    transport.throwError = "boom";
    const response = await postPlan(actor.cookie, tripId);
    expect(response.status).toBe(201);
    const planId = response.body.id as string;
    await afterResponse.drain();

    const rows = await db.admin.query<{ id: string }>(
      "SELECT id FROM planning.plans WHERE id = $1",
      [planId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(dispatchLog.entries[0]?.result).toBe("dropped");
  });
});

describe("消えた宛先の無効化（PD-18・PD-19）", () => {
  it("PD-18: 404/410のときだけ購読を無効にする（同じ版のときだけ）", async () => {
    const actor = await newUser("actor6");
    const partner = await newUser("partner6");
    const tripId = await createTrip(actor.cookie);
    const gone = await seedSub(partner.userId);

    transport.status = 410;
    await triggerPlanAdded(actor.cookie, tripId);
    expect(transport.calls).toHaveLength(1);
    expect(await subEnabled(gone.id)).toBe(false);
    expect(dispatchLog.entries[0]?.result).toBe("gone");
  });

  it.each([400, 401, 403, 429, 500])(
    "PD-19: %iでは購読を無効にしない",
    async (status) => {
      const actor = await newUser("actor7");
      const partner = await newUser("partner7");
      const tripId = await createTrip(actor.cookie);
      const sub = await seedSub(partner.userId);

      transport.status = status;
      await triggerPlanAdded(actor.cookie, tripId);
      expect(await subEnabled(sub.id)).toBe(true);
    },
  );
});

describe("記録に秘密を出さない（PD-20・PD-21）", () => {
  it("PD-20: 届けた記録の中身に宛先・鍵・中身・名前を含めない", async () => {
    const actor = await newUser("actor8");
    const partner = await newUser("partner8");
    const tripId = await createTrip(actor.cookie);
    const sub = await seedSub(partner.userId);

    // 実際のstdoutも同時に集めて、両方で確かめる。
    const chunks: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await triggerPlanAdded(actor.cookie, tripId);
    } finally {
      process.stdout.write = originalWrite;
    }

    const recorded = JSON.stringify(dispatchLog.entries);
    const printed = chunks.join("");
    for (const haystack of [recorded, printed]) {
      expect(haystack).not.toContain(sub.endpoint);
      expect(haystack).not.toContain("fcm/send");
      expect(haystack).not.toContain("actor8");
      expect(haystack).not.toContain("partner8");
      expect(haystack).not.toContain("清水寺");
      expect(haystack).not.toContain(TRIP_BODY.name);
      expect(haystack).not.toContain("p256dh");
      expect(haystack).not.toContain("auth_secret");
      expect(haystack).not.toContain("plan_added");
    }
    // 記録自体は行われている。
    expect(dispatchLog.entries.length).toBeGreaterThan(0);
    expect(dispatchLog.entries[0]?.result).toBe("accepted");
    expect(dispatchLog.entries[0]?.subscriptionId).toBeDefined();
    expect(dispatchLog.entries[0]?.eventId).toBeDefined();
  });

  it("PD-21: 許可されていない宛先の購読（直接INSERT）には送らず、理由を記録する", async () => {
    const actor = await newUser("actor9");
    const partner = await newUser("partner9");
    const tripId = await createTrip(actor.cookie);
    const badEndpoint = "https://evil.example.com/x";
    await seedSub(partner.userId, { endpoint: badEndpoint });

    await triggerPlanAdded(actor.cookie, tripId);
    expect(transport.calls).toHaveLength(0);
    expect(dispatchLog.entries[0]?.result).toBe("dropped");
    expect(dispatchLog.entries[0]?.reason).toBe("host_not_allowed");
    expect(JSON.stringify(dispatchLog.entries)).not.toContain(badEndpoint);
  });
});
