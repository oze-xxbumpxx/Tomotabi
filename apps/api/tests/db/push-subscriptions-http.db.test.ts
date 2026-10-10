import { createECDH, createHash, randomBytes, randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import type { Auth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import type { TestHelpers } from "better-auth/plugins";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { closePool, getPool } from "../../src/infrastructure/database/pool";
import { createAuth } from "../../src/modules/identity/infrastructure/better-auth";
import { VAPID_KEYRING } from "../../src/modules/notification/adapter/outbound/vapid-keyring.port";
import { EnvVapidKeyring } from "../../src/modules/notification/infrastructure/env-vapid-keyring";
import {
  createRoles,
  migrateAsMigrator,
  startPostgres,
  type TestDatabase,
} from "../support/database";
import { createHttpTestApp } from "../support/nest-app";

const ORIGIN = "http://localhost:3000";

/** VAPIDの鍵の検証用ペア（現在の鍵・退いた鍵・失効した鍵）。 */
const vapidCurrent = createECDH("prime256v1");
vapidCurrent.generateKeys();
const vapidRetired = createECDH("prime256v1");
vapidRetired.generateKeys();
const VAPID_KEYS_JSON = JSON.stringify([
  {
    keyId: "current-key",
    state: "current",
    publicKey: vapidCurrent.getPublicKey().toString("base64url"),
    privateKey: vapidCurrent.getPrivateKey().toString("base64url"),
  },
  {
    keyId: "retired-key",
    state: "retired",
    publicKey: vapidRetired.getPublicKey().toString("base64url"),
    privateKey: vapidRetired.getPrivateKey().toString("base64url"),
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

/** 実際のP-256の点と16バイトのauthを持つ購読の鍵。 */
function newSubKeys(): { p256dh: string; auth: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  };
}

/** 許可ホスト上の一意な宛先。 */
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

/** 登録が成功することを確かめて応答を返す。 */
async function register(
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string } & Record<string, unknown>> {
  const response = await putSubscription(cookie, registrationBody(overrides));
  expect(response.status).toBe(200);
  return response.body as { id: string } & Record<string, unknown>;
}

// 許可リストはslot 0/1の2枠固定。試験ごとの利用者は2人を同時に
// 持たないため、slotを交互に差し替える（前の利用者の許可は外れるが
// その試験は済んでいる）。
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
  const cookie = await loginCookie(userId);
  return { userId, cookie };
}

/** 同じ利用者の新しいログインのcookie（別セッションの購読を作る用）。 */
async function loginCookie(userId: string): Promise<string> {
  const login = await testHelpers.login({ userId });
  const cookie = login.headers.get("cookie");
  if (cookie === null) {
    throw new Error("login did not produce a cookie header");
  }
  return cookie;
}

async function latestSessionId(userId: string): Promise<string> {
  const result = await db.admin.query<{ id: string }>(
    `SELECT id FROM identity.sessions WHERE user_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  return result.rows[0]!.id;
}

type SeededSub = {
  endpoint: string;
  sessionId: string;
  vapidKeyId: string;
  enabled: boolean;
  expirationTime: Date | null;
};

/** APIを通さず購読の行を種する（過去の期限・別セッションの印など）。 */
async function seedSub(
  userId: string,
  overrides: Partial<SeededSub> = {},
): Promise<string> {
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
  const result = await db.admin.query<{ id: string }>(
    `INSERT INTO notification.push_subscriptions
       (id, user_id, endpoint, endpoint_hash, p256dh, auth_secret,
        expiration_time, registration_session_id, device_label, vapid_key_id, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '種した端末', $9, $10)
     RETURNING id`,
    [
      randomUUID(),
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
  return result.rows[0]!.id;
}

async function enabledCount(userId: string): Promise<number> {
  const result = await db.admin.query<{ count: string }>(
    `SELECT count(*)::int AS count FROM notification.push_subscriptions
     WHERE user_id = $1 AND enabled`,
    [userId],
  );
  return Number(result.rows[0]!.count);
}

async function subRow(id: string): Promise<{
  enabled: boolean;
  revision: string;
  user_id: string;
} | null> {
  const result = await db.admin.query<{
    enabled: boolean;
    revision: string;
    user_id: string;
  }>(
    `SELECT enabled, revision::text AS revision, user_id
     FROM notification.push_subscriptions WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

const PUBLIC_ITEM_KEYS = [
  "deviceLabel",
  "enabled",
  "id",
  "isCurrentSession",
  "updatedAt",
  "vapidKeyState",
];

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

describe("購読の登録と再登録（PD-02）", () => {
  it("登録は公開の項目だけを返し、同じ中身の再送は版を上げない", async () => {
    const user = await newUser("pd02");
    const body = registrationBody();

    const first = await putSubscription(user.cookie, body);
    expect(first.status).toBe(200);
    expect(first.headers["cache-control"]).toBe("private, no-store");
    expect(Object.keys(first.body).sort()).toEqual(PUBLIC_ITEM_KEYS);
    expect(first.body).toMatchObject({
      deviceLabel: "この端末",
      enabled: true,
      vapidKeyState: "current",
      isCurrentSession: true,
    });
    const id = first.body.id as string;

    // 同じ中身の再送は更新にならない（revisionもupdated_atも動かない）。
    const again = await putSubscription(user.cookie, body);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(id);
    expect(again.body.updatedAt).toBe(first.body.updatedAt);
    expect((await subRow(id))?.revision).toBe("1");

    // 中身が変わる再登録は同じIDのまま版を上げる。
    const changed = await putSubscription(
      user.cookie,
      registrationBody({
        endpoint: body.endpoint,
        keys: newSubKeys(),
        deviceLabel: "新しい名前",
      }),
    );
    expect(changed.status).toBe(200);
    expect(changed.body.id).toBe(id);
    expect((await subRow(id))?.revision).toBe("2");
  });

  it("宛先は正規化した値で保存し、ハッシュもその値から作る", async () => {
    const user = await newUser("pd02n");
    const tag = randomUUID();
    const body = registrationBody();

    // :443の表記は解析で取り除かれる。保存・ハッシュは取り除いた値で行う。
    const first = await putSubscription(user.cookie, {
      ...body,
      endpoint: `https://fcm.googleapis.com:443/fcm/send/${tag}`,
    });
    expect(first.status).toBe(200);
    const id = first.body.id as string;
    const normalized = `https://fcm.googleapis.com/fcm/send/${tag}`;
    const rows = await db.admin.query<{
      endpoint: string;
      endpoint_hash: Buffer;
    }>(
      `SELECT endpoint, endpoint_hash
       FROM notification.push_subscriptions WHERE id = $1`,
      [id],
    );
    expect(rows.rows[0]?.endpoint).toBe(normalized);
    expect(
      rows.rows[0]?.endpoint_hash.equals(
        createHash("sha256").update(normalized, "utf8").digest(),
      ),
    ).toBe(true);

    // 表記の違う同じ宛先（大文字のホスト）も同じ行に届き、冪等に返る。
    const again = await putSubscription(user.cookie, {
      ...body,
      endpoint: `https://FCM.GOOGLEAPIS.COM/fcm/send/${tag}`,
    });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(id);
    expect((await subRow(id))?.revision).toBe("1");
  });
});

describe("有効な購読の上限と期限切れの整理（PD-03）", () => {
  it("有効は3台まで。4台目・無効からの復帰も数えて409", async () => {
    const user = await newUser("pd03");
    const firstEndpoint = newEndpoint("first");
    const first = await register(user.cookie, { endpoint: firstEndpoint });
    await register(user.cookie);
    await register(user.cookie);

    const fourth = await putSubscription(user.cookie, registrationBody());
    expect(fourth.status).toBe(409);
    expect(fourth.body.code).toBe("PUSH_LIMIT_REACHED");

    // 1台を無効にすると別の宛先は登録できる。
    const removed = await authed(
      http().delete(`/api/me/push-subscriptions/${first.id}`),
      user.cookie,
    );
    expect(removed.status).toBe(204);
    const other = await putSubscription(user.cookie, registrationBody());
    expect(other.status).toBe(200);
    // ここで有効3台。無効だった同じ宛先を有効に戻すのも1増えるため断る。
    const revive = await putSubscription(
      user.cookie,
      registrationBody({ endpoint: firstEndpoint }),
    );
    expect(revive.status).toBe(409);
    expect(revive.body.code).toBe("PUSH_LIMIT_REACHED");
  });

  it("期限の過ぎた購読は数える前に無効になる", async () => {
    const user = await newUser("pd03b");
    await register(user.cookie);
    await register(user.cookie);
    // 期限切れの行を種して有効3台に見せる（うち1台は期限切れ）。
    // ログインは生きている実セッションにし、「期限切れ」だけを試す。
    await seedSub(user.userId, {
      expirationTime: new Date(Date.now() - 60_000),
      sessionId: await latestSessionId(user.userId),
    });
    expect(await enabledCount(user.userId)).toBe(3);

    // 期限切れは上限を数える前に無効化されるため、新しい宛先を登録できる。
    const response = await putSubscription(user.cookie, registrationBody());
    expect(response.status).toBe(200);
    expect(await enabledCount(user.userId)).toBe(3);
  });

  it("登録したログインが期限切れ・消えた購読は上限に数えず、一覧で無効に見える", async () => {
    const user = await newUser("pd03c");
    // 3台を別々のログインで登録する（ログインごとに別のセッションができる）。
    const session1 = await latestSessionId(user.userId);
    const sub1 = await register(user.cookie);
    const cookie2 = await loginCookie(user.userId);
    const session2 = await latestSessionId(user.userId);
    const sub2 = await register(cookie2);
    const cookie3 = await loginCookie(user.userId);
    const session3 = await latestSessionId(user.userId);
    const sub3 = await register(cookie3);
    expect(new Set([session1, session2, session3]).size).toBe(3);
    expect(await enabledCount(user.userId)).toBe(3);

    // 1台目のログインを期限切れにし、2台目のログインの行を消す。
    await db.admin.query(
      "UPDATE identity.sessions SET expires_at = $1 WHERE id = $2",
      [new Date(Date.now() - 60_000), session1],
    );
    await db.admin.query("DELETE FROM identity.sessions WHERE id = $1", [
      session2,
    ]);

    // 届かない購読は一覧でenabled: falseに見える（行はまだ変わらない）。
    const list = await authed(
      http().get("/api/me/push-subscriptions"),
      cookie3,
    );
    expect(list.status).toBe(200);
    const byId = new Map(
      (list.body.items as Record<string, unknown>[]).map((item) => [
        item.id as string,
        item,
      ]),
    );
    expect(byId.get(sub1.id)).toMatchObject({ enabled: false });
    expect(byId.get(sub2.id)).toMatchObject({ enabled: false });
    expect(byId.get(sub3.id)).toMatchObject({
      enabled: true,
      isCurrentSession: true,
    });
    expect((await subRow(sub1.id))?.enabled).toBe(true);

    // 上限に数えないため4台目の登録は200。外れた2台は実際に無効化される。
    const fourth = await putSubscription(cookie3, registrationBody());
    expect(fourth.status).toBe(200);
    expect(await enabledCount(user.userId)).toBe(2);
    expect((await subRow(sub1.id))?.enabled).toBe(false);
    expect((await subRow(sub2.id))?.enabled).toBe(false);
    // 今のログインの購読は有効のまま。
    expect((await subRow(sub3.id))?.enabled).toBe(true);
  });
});

describe("同時の登録の直列化（PD-04）", () => {
  it("同じ人が別の宛先を2接続で同時に送っても有効は3台を超えない", async () => {
    const user = await newUser("pd04");
    await register(user.cookie);
    await register(user.cookie);

    const [a, b] = await Promise.all([
      putSubscription(user.cookie, registrationBody()),
      putSubscription(user.cookie, registrationBody()),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(await enabledCount(user.userId)).toBe(3);
  });
});

describe("宛先の持ち主（PD-05）", () => {
  it("他人が登録した宛先は409 PUSH_ENDPOINT_OWNED_BY_OTHER", async () => {
    const owner = await newUser("pd05a");
    const other = await newUser("pd05b");
    const endpoint = newEndpoint("owned");
    await register(owner.cookie, { endpoint });

    const response = await putSubscription(
      other.cookie,
      registrationBody({ endpoint }),
    );
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("PUSH_ENDPOINT_OWNED_BY_OTHER");
  });

  it("別々の人が同じ宛先を同時に登録しても行は1つ", async () => {
    const a = await newUser("pd05c");
    const b = await newUser("pd05d");
    const endpoint = newEndpoint("race");

    const [resA, resB] = await Promise.all([
      putSubscription(a.cookie, registrationBody({ endpoint })),
      putSubscription(b.cookie, registrationBody({ endpoint })),
    ]);
    const results = [resA, resB].map((r) => ({
      status: r.status,
      code: r.body?.code as string | undefined,
    }));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(
      results.filter(
        (r) => r.status === 409 && r.code === "PUSH_ENDPOINT_OWNED_BY_OTHER",
      ),
    ).toHaveLength(1);
    const rows = await db.admin.query(
      `SELECT count(*)::int AS count FROM notification.push_subscriptions
       WHERE endpoint_hash = $1`,
      [createHash("sha256").update(endpoint, "utf8").digest()],
    );
    expect(Number(rows.rows[0]!.count)).toBe(1);
  });

  it("無効になった他人の購読は新しい持ち主が引き取る", async () => {
    const owner = await newUser("pd05e");
    const taker = await newUser("pd05f");
    const endpoint = newEndpoint("takeover");
    const registered = await register(owner.cookie, { endpoint });
    const id = registered.id as string;

    // 持ち主が無効にした行を、別の人が同じ宛先の登録で引き取る。
    const removed = await authed(
      http().delete(`/api/me/push-subscriptions/${id}`),
      owner.cookie,
    );
    expect(removed.status).toBe(204);
    expect((await subRow(id))?.enabled).toBe(false);

    const response = await putSubscription(
      taker.cookie,
      registrationBody({ endpoint, deviceLabel: "引き取った端末" }),
    );
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(id);
    const row = await subRow(id);
    // 持ち主・中身・有効が登録の内容に書き換わり、版が上がる。
    expect(row?.user_id).toBe(taker.userId);
    expect(row?.enabled).toBe(true);
    expect(row?.revision).toBe("3");
    expect(response.body).toMatchObject({
      deviceLabel: "引き取った端末",
      enabled: true,
      isCurrentSession: true,
    });

    // 引き取られたあとは有効な他人の行なので、元の持ち主の登録は409。
    const again = await putSubscription(
      owner.cookie,
      registrationBody({ endpoint }),
    );
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("PUSH_ENDPOINT_OWNED_BY_OTHER");
  });

  it("引き取りも有効な数が1件増えるため、有効3台の人は引き取れない", async () => {
    const owner = await newUser("pd05g");
    const taker = await newUser("pd05h");
    const endpoint = newEndpoint("takeover-limit");
    const registered = await register(owner.cookie, { endpoint });
    await authed(
      http().delete(`/api/me/push-subscriptions/${registered.id}`),
      owner.cookie,
    );

    // 引き取る側は既に有効3台。
    await register(taker.cookie);
    await register(taker.cookie);
    await register(taker.cookie);
    const response = await putSubscription(
      taker.cookie,
      registrationBody({ endpoint }),
    );
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("PUSH_LIMIT_REACHED");
  });

  it("無効な行を2人が同時に引き取りに来ても勝つのは1人", async () => {
    const owner = await newUser("pd05i");
    const endpoint = newEndpoint("takeover-race");
    const registered = await register(owner.cookie, { endpoint });
    const id = registered.id as string;
    await authed(
      http().delete(`/api/me/push-subscriptions/${id}`),
      owner.cookie,
    );
    // 許可枠は2つ。引き取りを試す2人をあとから作る（元の持ち主の
    // 許可は外れるが、その利用者の操作は済んでいる）。
    const a = await newUser("pd05j");
    const b = await newUser("pd05k");

    const [resA, resB] = await Promise.all([
      putSubscription(a.cookie, registrationBody({ endpoint })),
      putSubscription(b.cookie, registrationBody({ endpoint })),
    ]);
    const results = [
      { user: a, res: resA },
      { user: b, res: resB },
    ];
    const winner = results.find((r) => r.res.status === 200);
    const loser = results.find((r) => r.res.status !== 200);
    expect(winner).toBeDefined();
    expect(loser).toBeDefined();
    // 負けた側は409 PUSH_ENDPOINT_OWNED_BY_OTHER。先に有効になった
    // 他人の行を読んで断るか、無効の行への書き直しが0件になっても
    // 「他人の宛先」と同じ409になる（500にはならない）。
    expect(loser!.res.status).toBe(409);
    expect(loser!.res.body.code).toBe("PUSH_ENDPOINT_OWNED_BY_OTHER");

    // 行は1つのまま、勝った側の持ち主で有効になっている。
    const rows = await db.admin.query<{ count: string }>(
      `SELECT count(*)::int AS count FROM notification.push_subscriptions
       WHERE endpoint_hash = $1`,
      [createHash("sha256").update(endpoint, "utf8").digest()],
    );
    expect(Number(rows.rows[0]!.count)).toBe(1);
    const row = await subRow(id);
    expect(row?.user_id).toBe(winner!.user.userId);
    expect(row?.enabled).toBe(true);
  });
});

describe("登録の断り（PD-06）", () => {
  it.each([
    "https://push.example.com/x",
    "http://fcm.googleapis.com/x",
    "https://fcm.googleapis.com.evil.example/x",
    "https://user@fcm.googleapis.com/x",
    // 生の文字列に制御文字が入る宛先は422（解析で取り除かれる前に断る）。
    "https://fcm.googleapis.com/fcm/send/\nx",
    // 先頭のラベルが空のAppleの宛先は422。
    "https://.push.apple.com/x",
  ])("許可しない宛先は422 UNSUPPORTED_PUSH_SERVICE: %s", async (endpoint) => {
    const user = await newUser(`pd06-${randomUUID().slice(0, 6)}`);
    const response = await putSubscription(
      user.cookie,
      registrationBody({ endpoint }),
    );
    expect(response.status).toBe(422);
    expect(response.body.code).toBe("UNSUPPORTED_PUSH_SERVICE");
  });

  it("形・曲線が違う鍵は422 INVALID_PUSH_SUBSCRIPTION", async () => {
    const user = await newUser("pd06k");
    const offCurve = (() => {
      const bytes = Buffer.alloc(65, 0);
      bytes[0] = 0x04;
      return bytes.toString("base64url");
    })();
    const response = await putSubscription(
      user.cookie,
      registrationBody({
        keys: { p256dh: offCurve, auth: newSubKeys().auth },
      }),
    );
    expect(response.status).toBe(422);
    expect(response.body.code).toBe("INVALID_PUSH_SUBSCRIPTION");
  });

  it.each([
    { keys: { p256dh: "short" } },
    { endpoint: 42 },
    { endpoint: "not a url" },
    { deviceLabel: "x".repeat(61) },
    { expirationTime: Date.now() - 1000 },
    // 制御文字（NULを含む）はDBのtextに入らないため400で断る。
    { deviceLabel: "端\u0000末" },
  ])("本文の形・大きさ・過去の期限は400: %j", async (overrides) => {
    const user = await newUser(`pd06f-${randomUUID().slice(0, 6)}`);
    const body = registrationBody(overrides as Record<string, unknown>);
    const response = await putSubscription(user.cookie, body);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_REQUEST");
  });

  it("今の鍵でないkeyIdは409 PUSH_KEY_CHANGED", async () => {
    const user = await newUser("pd06r");
    const response = await putSubscription(
      user.cookie,
      registrationBody({ keyId: "retired-key" }),
    );
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("PUSH_KEY_CHANGED");
  });

  it("鍵の束が読めないときのPUTは409 PUSH_KEY_CHANGED", async () => {
    const brokenRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(VAPID_KEYRING)
      .useValue(EnvVapidKeyring.fromEnv({}))
      .compile();
    const brokenApp = await createHttpTestApp(brokenRef, auth);
    try {
      const user = await newUser(`pd06kb-${randomUUID().slice(0, 6)}`);
      const response = await request(brokenApp.getHttpServer())
        .put("/api/me/push-subscriptions")
        .set("Cookie", user.cookie)
        .set("Origin", ORIGIN)
        .set("Content-Type", "application/json")
        .send(registrationBody());
      expect(response.status).toBe(409);
      expect(response.body.code).toBe("PUSH_KEY_CHANGED");
    } finally {
      await brokenApp.close();
    }
  });

  it("停止の記録に今のセッションがある登録は409 PUSH_SESSION_CLOSED", async () => {
    const user = await newUser("pd06s");
    const sessionId = await latestSessionId(user.userId);
    await db.admin.query(
      `INSERT INTO notification.closed_push_sessions (session_id, user_id)
       VALUES ($1, $2)`,
      [sessionId, user.userId],
    );
    const response = await putSubscription(user.cookie, registrationBody());
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("PUSH_SESSION_CLOSED");
  });
});

describe("購読の一覧（PD-07）", () => {
  it("自分の購読だけを公開の項目で返し、鍵の状態とこの端末の印が付く", async () => {
    const user = await newUser("pd07");
    const stranger = await newUser("pd07s");
    await register(stranger.cookie);

    const mine1 = await register(user.cookie);
    const mine2 = await register(user.cookie);
    // 退いた鍵の有効な購読は、別のログインで登録した端末に見せる。
    await loginCookie(user.userId);
    const retiredId = await seedSub(user.userId, {
      vapidKeyId: "retired-key",
      sessionId: await latestSessionId(user.userId),
    });
    const revokedId = await seedSub(user.userId, {
      vapidKeyId: "revoked-key",
      enabled: false,
    });

    const response = await authed(
      http().get("/api/me/push-subscriptions"),
      user.cookie,
    );
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const items = response.body.items as Record<string, unknown>[];
    expect(items).toHaveLength(4);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(PUBLIC_ITEM_KEYS);
    }
    const byId = new Map(items.map((item) => [item.id as string, item]));
    expect(byId.get(mine1.id as string)).toMatchObject({
      vapidKeyState: "current",
      isCurrentSession: true,
      enabled: true,
    });
    expect(byId.get(mine2.id as string)).toMatchObject({
      vapidKeyState: "current",
      isCurrentSession: true,
    });
    expect(byId.get(retiredId)).toMatchObject({
      vapidKeyState: "retired",
      isCurrentSession: false,
    });
    expect(byId.get(revokedId)).toMatchObject({
      vapidKeyState: "revoked",
      isCurrentSession: false,
      enabled: false,
    });
  });
});

describe("購読の無効化（PD-08）", () => {
  it("何度送っても204。他人の・無いIDも204で他人の購読は有効のまま", async () => {
    const user = await newUser("pd08");
    const other = await newUser("pd08o");
    const mine = await register(user.cookie);
    const theirs = await register(other.cookie);

    const first = await authed(
      http().delete(`/api/me/push-subscriptions/${mine.id}`),
      user.cookie,
    );
    expect(first.status).toBe(204);
    expect((await subRow(mine.id as string))?.enabled).toBe(false);

    const again = await authed(
      http().delete(`/api/me/push-subscriptions/${mine.id}`),
      user.cookie,
    );
    expect(again.status).toBe(204);

    const foreign = await authed(
      http().delete(`/api/me/push-subscriptions/${theirs.id}`),
      user.cookie,
    );
    expect(foreign.status).toBe(204);
    expect((await subRow(theirs.id as string))?.enabled).toBe(true);

    const missing = await authed(
      http().delete(`/api/me/push-subscriptions/${randomUUID()}`),
      user.cookie,
    );
    expect(missing.status).toBe(204);
    expect(missing.headers["cache-control"]).toBe("private, no-store");
  });
});

describe("購読の設定（PD-09）", () => {
  it("今の鍵の公開鍵・keyId・上限を返す", async () => {
    const user = await newUser("pd09");
    const response = await authed(
      http().get("/api/me/push-config"),
      user.cookie,
    );
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toEqual({
      publicVapidKey: vapidCurrent.getPublicKey().toString("base64url"),
      keyId: "current-key",
      maxActiveSubscriptions: 3,
    });
  });

  it.each([
    ["鍵の設定が無い", {}],
    [
      "鍵の設定が崩れている",
      { VAPID_KEYS: "{broken", VAPID_SUBJECT: "mailto:x@y.test" },
    ],
  ])("%sときは503 PUSH_UNAVAILABLE", async (_label, env) => {
    const brokenRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(VAPID_KEYRING)
      .useValue(EnvVapidKeyring.fromEnv(env))
      .compile();
    const brokenApp = await createHttpTestApp(brokenRef, auth);
    try {
      const user = await newUser(`pd09-${randomUUID().slice(0, 6)}`);
      const response = await request(brokenApp.getHttpServer())
        .get("/api/me/push-config")
        .set("Cookie", user.cookie)
        .set("Origin", ORIGIN);
      expect(response.status).toBe(503);
      expect(response.body.code).toBe("PUSH_UNAVAILABLE");
    } finally {
      await brokenApp.close();
    }
  });
});

describe("4つのAPIの共通の振る舞い（PD-10）", () => {
  it("ログインなしは401", async () => {
    const noCookie = (req: request.Test) =>
      req.set("Origin", ORIGIN).set("Content-Type", "application/json");
    const responses: request.Response[] = [];
    responses.push(await noCookie(http().get("/api/me/push-config")));
    responses.push(
      await noCookie(http().get("/api/me/push-subscriptions")),
    );
    responses.push(
      await noCookie(http().put("/api/me/push-subscriptions")).send(
        registrationBody(),
      ),
    );
    responses.push(
      await noCookie(
        http().delete(`/api/me/push-subscriptions/${randomUUID()}`),
      ),
    );
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body.code).toBe("UNAUTHENTICATED");
    }
  });

  it("利用許可の無い利用者は403", async () => {
    const user = await newUser("pd10");
    await db.admin.query(
      `UPDATE identity.allowed_google_accounts SET enabled = FALSE
       WHERE user_id = $1`,
      [user.userId],
    );
    const responses = await Promise.all([
      authed(http().get("/api/me/push-config"), user.cookie),
      authed(http().get("/api/me/push-subscriptions"), user.cookie),
      putSubscription(user.cookie, registrationBody()),
      authed(
        http().delete(`/api/me/push-subscriptions/${randomUUID()}`),
        user.cookie,
      ),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("FORBIDDEN_NOT_ALLOWED");
    }
  });

  it("PUT・DELETEのOriginの誤りは403", async () => {
    const user = await newUser("pd10o");
    const badOrigin = (req: request.Test) =>
      req
        .set("Cookie", user.cookie)
        .set("Origin", "https://evil.example")
        .set("Content-Type", "application/json");
    const put = await badOrigin(
      http().put("/api/me/push-subscriptions"),
    ).send(registrationBody());
    expect(put.status).toBe(403);
    expect(put.body.code).toBe("FORBIDDEN_ORIGIN");
    const del = await badOrigin(
      http().delete(`/api/me/push-subscriptions/${randomUUID()}`),
    );
    expect(del.status).toBe(403);
    expect(del.body.code).toBe("FORBIDDEN_ORIGIN");
  });
});
