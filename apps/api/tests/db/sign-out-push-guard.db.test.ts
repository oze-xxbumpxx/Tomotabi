import { createECDH, createHash, randomBytes, randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import type { Auth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import type { TestHelpers } from "better-auth/plugins";
import type { Pool, PoolClient } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { closePool, getPool } from "../../src/infrastructure/database/pool";
import { SESSION_VERIFIER } from "../../src/modules/identity/adapter/outbound/session-verifier";
import { createAuth } from "../../src/modules/identity/infrastructure/better-auth";
import {
  CLOSE_PUSH_SESSION_INPUT_PORT,
  type ClosePushSessionInputPort,
} from "../../src/modules/notification/adapter/inbound/close-push-session.input-port";
import {
  createRoles,
  migrateAsMigrator,
  startPostgres,
  type TestDatabase,
} from "../support/database";
import { createHttpTestApp } from "../support/nest-app";

const ORIGIN = "http://localhost:3000";
const SESSION_COOKIE = "travel.session_token";

const vapidCurrent = createECDH("prime256v1");
vapidCurrent.generateKeys();
const VAPID_KEYS_JSON = JSON.stringify([
  {
    keyId: "current-key",
    state: "current",
    publicKey: vapidCurrent.getPublicKey().toString("base64url"),
    privateKey: vapidCurrent.getPrivateKey().toString("base64url"),
  },
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

let db: TestDatabase;
let app: NestExpressApplication;
let moduleRef: TestingModule;
let auth: Auth;
let testHelpers: TestHelpers;
let runtimePool: Pool;
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

function signOut(cookie: string | null): Promise<request.Response> {
  const req = http()
    .post("/api/auth/sign-out")
    .set("Origin", ORIGIN)
    .set("Content-Type", "application/json");
  return (cookie === null ? req : req.set("Cookie", cookie)).send({});
}

function newSubKeys(): { p256dh: string; auth: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  };
}

function newEndpoint(tag = "sub"): string {
  return `https://fcm.googleapis.com/fcm/send/${tag}-${randomUUID()}`;
}

function registrationBody(overrides: Record<string, unknown> = {}) {
  return {
    endpoint: newEndpoint(),
    keys: newSubKeys(),
    expirationTime: null,
    deviceLabel: "この端末",
    keyId: "current-key",
    ...overrides,
  };
}

function putSubscription(
  cookie: string,
  body: Record<string, unknown>,
): Promise<request.Response> {
  return authed(http().put("/api/me/push-subscriptions"), cookie).send(body);
}

async function register(cookie: string): Promise<{ id: string }> {
  const response = await putSubscription(cookie, registrationBody());
  expect(response.status).toBe(200);
  return response.body as { id: string };
}

// 許可リストはslot 0/1の2枠固定。試験ごとの利用者は2人を同時に
// 持たないため、slotを交互に差し替える。
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

async function latestSessionId(userId: string): Promise<string> {
  const result = await db.admin.query<{ id: string }>(
    `SELECT id FROM identity.sessions WHERE user_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  return result.rows[0]!.id;
}

async function sessionCount(userId: string): Promise<number> {
  const result = await db.admin.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM identity.sessions WHERE user_id = $1",
    [userId],
  );
  return Number(result.rows[0]!.count);
}

/** APIを通さず別セッションの購読の行を種する（ほかの端末の役）。 */
async function seedSub(
  userId: string,
  sessionId = `seeded-session-${randomUUID()}`,
): Promise<string> {
  const endpoint = newEndpoint("seeded");
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const result = await db.admin.query<{ id: string }>(
    `INSERT INTO notification.push_subscriptions
       (id, user_id, endpoint, endpoint_hash, p256dh, auth_secret,
        expiration_time, registration_session_id, device_label, vapid_key_id, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, '種した端末', 'current-key', TRUE)
     RETURNING id`,
    [
      randomUUID(),
      userId,
      endpoint,
      createHash("sha256").update(endpoint, "utf8").digest(),
      ecdh.getPublicKey(),
      randomBytes(16),
      sessionId,
    ],
  );
  return result.rows[0]!.id;
}

async function subRow(
  id: string,
): Promise<{ enabled: boolean; revision: string } | null> {
  const result = await db.admin.query<{
    enabled: boolean;
    revision: string;
  }>(
    `SELECT enabled, revision::text AS revision
     FROM notification.push_subscriptions WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

async function isSessionClosed(sessionId: string): Promise<boolean> {
  const result = await db.admin.query(
    "SELECT 1 FROM notification.closed_push_sessions WHERE session_id = $1",
    [sessionId],
  );
  return result.rows.length > 0;
}

/** identity.usersの行をFOR UPDATEで持ったままの接続を返す（PD-14の並び替え用）。 */
async function holdUserRowLock(userId: string): Promise<PoolClient> {
  const client = await db.admin.connect();
  await client.query("BEGIN");
  await client.query(
    "SELECT id FROM identity.users WHERE id = $1 FOR UPDATE",
    [userId],
  );
  return client;
}

/** lockOwnerで待っている要求が n 件並ぶまで待つ。 */
async function waitForLockWaiters(count: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const result = await db.admin.query<{ count: string }>(
      `SELECT count(*)::int AS count FROM pg_stat_activity
       WHERE wait_event_type = 'Lock' AND query ILIKE '%for update%'`,
    );
    if (Number(result.rows[0]!.count) >= count) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error("ロック待ちの要求が並ばなかった");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

beforeAll(async () => {
  db = await startPostgres();
  await createRoles(db);
  await migrateAsMigrator(db);

  TEST_ENV.DATABASE_URL = db.urlFor("app_runtime");
  for (const [key, value] of Object.entries(TEST_ENV)) {
    process.env[key] = value;
  }

  runtimePool = getPool();
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
  }).compile();
  app = await createHttpTestApp(moduleRef, auth);
});

afterAll(async () => {
  await app?.close();
  await closePool();
  await db?.stop();
  for (const key of Object.keys(TEST_ENV)) {
    delete process.env[key];
  }
});

describe("ログアウトで通知を止める（PD-11）", () => {
  it("停止の記録が入りこのセッションの購読だけ無効になる。ほかの端末の購読は有効のまま", async () => {
    const user = await newUser("pd11");
    const sessionId = await latestSessionId(user.userId);
    const own = await register(user.cookie);
    const otherDevice = await seedSub(user.userId);

    const response = await signOut(user.cookie);
    expect(response.status).toBe(200);
    expect(response.headers["x-push-stopped"]).toBe("true");
    const setCookies = response.headers["set-cookie"];
    const list = Array.isArray(setCookies)
      ? setCookies
      : setCookies === undefined
        ? []
        : [setCookies];
    expect(
      list.some((value) => value.startsWith(`${SESSION_COOKIE}=`)),
    ).toBe(true);

    // 停止の記録が入り、このセッションで登録した購読だけが無効になる
    // （版が上がる）。別のセッションの購読は有効のまま。
    expect(await isSessionClosed(sessionId)).toBe(true);
    expect(await subRow(own.id)).toMatchObject({
      enabled: false,
      revision: "2",
    });
    expect(await subRow(otherDevice)).toMatchObject({
      enabled: true,
      revision: "1",
    });
    expect(await sessionCount(user.userId)).toBe(0);

    // もう一度押す: セッションは既に無いのでunauthenticatedで素通りし、
    // 200 X-Push-Stopped: false。DBの状態は変わらない。
    const again = await signOut(user.cookie);
    expect(again.status).toBe(200);
    expect(again.headers["x-push-stopped"]).toBe("false");
    expect(await subRow(otherDevice)).toMatchObject({ enabled: true });

    // 停止の記録の追加はON CONFLICT DO NOTHING。UseCaseを同じ
    // セッションで再実行しても成功し、結果は変わらない（冪等）。
    const closeSession = app.get<ClosePushSessionInputPort>(
      CLOSE_PUSH_SESSION_INPUT_PORT,
    );
    await closeSession.execute(user.userId, sessionId);
    expect(await isSessionClosed(sessionId)).toBe(true);
    expect(await subRow(own.id)).toMatchObject({
      enabled: false,
      revision: "2",
    });
    expect(await subRow(otherDevice)).toMatchObject({
      enabled: true,
      revision: "1",
    });
  });
});

describe("ログアウトの経路の照合", () => {
  it("POST /api/AUTH/sign-outでは停止の記録が入らず購読が有効のまま、セッションも残る", async () => {
    const user = await newUser("pd11case");
    const sessionId = await latestSessionId(user.userId);
    const own = await register(user.cookie);

    // Expressの経路照合は大文字小文字を区別しないため、ガードがmountの
    // 照合に任せるとこの要求にも載ってしまう。Better Authは/api/authの
    // 完全一致で処理するので404になり、ログアウトは起きない。ガードも
    // 同じ完全一致で判定するなら動かず、停止の記録・購読・セッションは
    // そのまま残る。
    const response = await http()
      .post("/api/AUTH/sign-out")
      .set("Origin", ORIGIN)
      .set("Cookie", user.cookie)
      .set("Content-Type", "application/json")
      .send({});

    expect(response.status).toBe(404);
    expect(response.headers["x-push-stopped"]).toBeUndefined();
    expect(await isSessionClosed(sessionId)).toBe(false);
    expect(await subRow(own.id)).toMatchObject({
      enabled: true,
      revision: "1",
    });
    expect(await sessionCount(user.userId)).toBe(1);
    const me = await authed(http().get("/api/me"), user.cookie);
    expect(me.status).toBe(200);
  });
});

describe("ログアウトの失敗（PD-12）", () => {
  it("通知を止めるDBの処理が失敗したら503 PUSH_STOP_FAILEDでセッションは残る", async () => {
    const user = await newUser("pd12");
    const sessionId = await latestSessionId(user.userId);
    const own = await register(user.cookie);

    // 停止の記録の表をロックし、lock_timeoutで失敗させる。
    const locker = await db.admin.connect();
    await locker.query("BEGIN");
    await locker.query(
      "LOCK TABLE notification.closed_push_sessions IN ACCESS EXCLUSIVE MODE",
    );
    let response: request.Response;
    try {
      response = await signOut(user.cookie);
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
    }

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("PUSH_STOP_FAILED");
    expect(response.body.retryable).toBe(true);

    // Better Authへは渡さないので、セッションと購読はそのまま残る。
    expect(await sessionCount(user.userId)).toBe(1);
    expect(await isSessionClosed(sessionId)).toBe(false);
    expect(await subRow(own.id)).toMatchObject({ enabled: true });
    const me = await authed(http().get("/api/me"), user.cookie);
    expect(me.status).toBe(200);
  });

  it("認証の基盤の障害（unavailable）でも503 PUSH_STOP_FAILED", async () => {
    const user = await newUser("pd12u");
    const sessionId = await latestSessionId(user.userId);
    const own = await register(user.cookie);
    const brokenRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SESSION_VERIFIER)
      .useValue({ verify: async () => ({ kind: "unavailable" }) })
      .compile();
    const brokenApp = await createHttpTestApp(brokenRef, auth);
    try {
      const response = await request(brokenApp.getHttpServer())
        .post("/api/auth/sign-out")
        .set("Origin", ORIGIN)
        .set("Cookie", user.cookie)
        .set("Content-Type", "application/json")
        .send({});
      expect(response.status).toBe(503);
      expect(response.body.code).toBe("PUSH_STOP_FAILED");
      expect(response.body.retryable).toBe(true);
      // Better Authへは渡さないので、停止の記録は入らず、
      // セッションと購読はそのまま残る。
      expect(await sessionCount(user.userId)).toBe(1);
      expect(await isSessionClosed(sessionId)).toBe(false);
      expect(await subRow(own.id)).toMatchObject({ enabled: true });
    } finally {
      await brokenApp.close();
    }
  });
});

describe("ログインが切れたログアウト（PD-13）", () => {
  it("Cookieが無ければDBに触れずBetter Authへ渡し、X-Push-Stopped: false", async () => {
    const before = await db.admin.query(
      "SELECT count(*)::int AS count FROM notification.closed_push_sessions",
    );
    const response = await signOut(null);
    expect(response.status).toBe(200);
    expect(response.headers["x-push-stopped"]).toBe("false");
    const setCookies = response.headers["set-cookie"];
    const list = Array.isArray(setCookies)
      ? setCookies
      : setCookies === undefined
        ? []
        : [setCookies];
    expect(
      list.some((value) => value.startsWith(`${SESSION_COOKIE}=`)),
    ).toBe(true);
    const after = await db.admin.query(
      "SELECT count(*)::int AS count FROM notification.closed_push_sessions",
    );
    expect(Number(after.rows[0]!.count)).toBe(Number(before.rows[0]!.count));
  });

  it("期限切れのセッションなら素通りし、購読と停止の記録は触らない", async () => {
    const user = await newUser("pd13");
    const sessionId = await latestSessionId(user.userId);
    const own = await register(user.cookie);
    await db.admin.query(
      "UPDATE identity.sessions SET expires_at = now() - interval '1 hour' WHERE id = $1",
      [sessionId],
    );

    const response = await signOut(user.cookie);
    expect(response.status).toBe(200);
    expect(response.headers["x-push-stopped"]).toBe("false");
    expect(await isSessionClosed(sessionId)).toBe(false);
    expect(await subRow(own.id)).toMatchObject({ enabled: true });
  });

  it("利用許可を外された人（forbidden）もDBに触れずBetter Authへ渡す", async () => {
    const user = await newUser("pd13f");
    const sessionId = await latestSessionId(user.userId);
    const own = await register(user.cookie);
    await db.admin.query(
      "UPDATE identity.allowed_google_accounts SET enabled = FALSE WHERE user_id = $1",
      [user.userId],
    );

    const response = await signOut(user.cookie);
    expect(response.status).toBe(200);
    expect(response.headers["x-push-stopped"]).toBe("false");
    expect(await sessionCount(user.userId)).toBe(0);
    expect(await isSessionClosed(sessionId)).toBe(false);
    expect(await subRow(own.id)).toMatchObject({ enabled: true });
  });
});

describe("ログアウトと登録の競合（PD-14）", () => {
  // ログアウトの前に認証された登録が、ログアウトのCOMMITのあとに行の
  // ロックを取ったら409 PUSH_SESSION_CLOSEDになることを10回確かめる。
  // 利用者の行を別接続でFOR UPDATEのまま持ち、sign-out → PUTの順に
  // lockOwnerで並ばせてから解放して並びを確定させる。
  it.each([...Array(10).keys()])(
    "ログアウトのCOMMIT後にロックを取った登録は409（%i回目）",
    async (i) => {
      const user = await newUser(`pd14-${i}`);
      const sessionId = await latestSessionId(user.userId);
      const holder = await holdUserRowLock(user.userId);
      try {
        // supertestのTestはlazyなthenableで、then/awaitされるまで
        // 要求を送らない。Promise.resolveで即座に送り、awaitするのは
        // 待機確認のあとにする。
        const signOutPromise = Promise.resolve(signOut(user.cookie));
        await waitForLockWaiters(1);
        const putPromise = Promise.resolve(
          putSubscription(user.cookie, registrationBody()),
        );
        await waitForLockWaiters(2);

        await holder.query("COMMIT");

        const [signOutResponse, putResponse] = await Promise.all([
          signOutPromise,
          putPromise,
        ]);
        expect(signOutResponse.status).toBe(200);
        expect(signOutResponse.headers["x-push-stopped"]).toBe("true");
        expect(putResponse.status).toBe(409);
        expect(putResponse.body.code).toBe("PUSH_SESSION_CLOSED");
        expect(await isSessionClosed(sessionId)).toBe(true);
      } finally {
        // COMMIT済みでもROLLBACKはNOTICEだけで成功し、失敗時はトランザクションを閉じる
        await holder.query("ROLLBACK").catch(() => {});
        holder.release();
      }
    },
  );
});
