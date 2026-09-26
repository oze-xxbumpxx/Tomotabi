import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import type { Auth } from "better-auth";
import type { TestHelpers } from "better-auth/plugins";
import { testUtils } from "better-auth/plugins";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import {
  closePool,
  getPool,
} from "../../src/infrastructure/database/pool";
import { createAuth } from "../../src/modules/identity/infrastructure/better-auth";
import {
  createRoles,
  migrateAsMigrator,
  startPostgres,
  type TestDatabase,
} from "../support/database";
import { createHttpTestApp } from "../support/nest-app";

const ORIGIN = "http://localhost:3000";
const EVIL_ORIGIN = "http://evil.example.test";
const SESSION_COOKIE = "travel.session_token";

const AUTH_ENV = {
  DATABASE_URL: "",
  PUBLIC_APP_ORIGIN: ORIGIN,
  BETTER_AUTH_SECRET: "test-secret-for-db-tests-only",
  GOOGLE_CLIENT_ID: "test-google-client-id",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
};

type FixtureUser = {
  userId: string;
  name: string;
  email: string;
  sub: string;
};

let db: TestDatabase;
let app: NestExpressApplication;
let auth: Auth;
let testHelpers: TestHelpers;
let runtimePool: Pool;
let hinata: FixtureUser;
let aoi: FixtureUser;

function http() {
  return request(app.getHttpServer());
}

function authed(
  req: request.Test,
  cookie: string,
  origin: string | null = ORIGIN,
): request.Test {
  req.set("Cookie", cookie);
  if (origin !== null) {
    req.set("Origin", origin);
  }
  return req;
}

async function insertUser(
  name: string,
  email: string,
): Promise<FixtureUser["userId"]> {
  const result = await db.admin.query<{ id: string }>(
    "INSERT INTO identity.users (name, email, email_verified) VALUES ($1, $2, TRUE) RETURNING id",
    [name, email],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error("user insert failed");
  }
  return id;
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
  enabled = true,
): Promise<void> {
  await db.admin.query(
    `INSERT INTO identity.allowed_google_accounts (slot, user_id, google_sub, enabled)
     VALUES ($1, $2, $3, $4)`,
    [slot, userId, sub, enabled],
  );
}

async function sessionCount(userId: string): Promise<number> {
  const result = await db.admin.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM identity.sessions WHERE user_id = $1",
    [userId],
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function sessionExpiresAt(userId: string): Promise<Date> {
  const result = await db.admin.query<{ expires_at: Date }>(
    "SELECT expires_at FROM identity.sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
    [userId],
  );
  const expires = result.rows[0]?.expires_at;
  if (!expires) {
    throw new Error("session row not found");
  }
  return expires;
}

async function login(userId: string): Promise<string> {
  const result = await testHelpers.login({ userId });
  const cookie = result.headers.get("cookie");
  if (cookie === null) {
    throw new Error("login did not produce a cookie header");
  }
  return cookie;
}

// Set-Cookie 一覧から Cookie ヘッダ用の `name=value; …` を作る。
function cookieHeader(setCookies: string[] | string | undefined): string {
  const list = Array.isArray(setCookies)
    ? setCookies
    : setCookies === undefined
      ? []
      : [setCookies];
  return list.map((value) => value.split(";")[0] ?? "").join("; ");
}

// 正規の sign-in で state と署名済み state Cookie を取得する
// （callback は Cookie の state とクエリの state の一致を検査する）。
async function startGoogleSignIn(): Promise<{ state: string; cookie: string }> {
  const response = await http()
    .post("/api/auth/sign-in/social")
    .set("Origin", ORIGIN)
    .set("Content-Type", "application/json")
    .send({ provider: "google", callbackURL: "/" });
  expect(response.status).toBe(200);
  const state = new URL(response.body.url).searchParams.get("state");
  if (!state) {
    throw new Error("authorization URL has no state");
  }
  return { state, cookie: cookieHeader(response.headers["set-cookie"]) };
}

/**
 * Google のトークン交換だけを差し替える（better-fetch は呼び出し時に
 * globalThis.fetch を解決する）。id_token は getUserInfo が署名を見ずに
 * decodeJwt で読むだけなので、payload だけの偽 JWT で足りる。
 * 戻り値の関数で元に戻す。
 */
function stubGoogleTokenEndpoint(account: {
  sub: string;
  email: string;
  name: string;
}): () => void {
  const originalFetch = globalThis.fetch;
  const idToken = [
    { alg: "RS256", typ: "JWT" },
    {
      sub: account.sub,
      email: account.email,
      email_verified: true,
      name: account.name,
      iss: "https://accounts.google.com",
      aud: AUTH_ENV.GOOGLE_CLIENT_ID,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    "fake-signature",
  ]
    .map((part) =>
      Buffer.from(typeof part === "string" ? part : JSON.stringify(part))
        .toString("base64url"),
    )
    .join(".");
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url === "https://oauth2.googleapis.com/token") {
      return new Response(
        JSON.stringify({
          access_token: "fake-access-token",
          id_token: idToken,
          token_type: "Bearer",
          expires_in: 3600,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function expectSignInRedirect(response: request.Response): void {
  expect(response.status).toBe(302);
  const location = response.headers.location as string;
  expect(location.startsWith(`${ORIGIN}/sign-in?error=`)).toBe(true);
}

function expectNoSecretsInLocation(response: request.Response): void {
  const location = response.headers.location as string;
  expect(location).not.toContain("access_token");
  expect(location).not.toContain("id_token");
  expect(location).not.toContain("refresh_token");
}

beforeAll(async () => {
  db = await startPostgres();
  await createRoles(db);
  await migrateAsMigrator(db);

  // A-14 の 200 側だけ、M0 の検査表を admin が作って app_runtime に読み書き権を渡す
  // （m0_probe.sql は本番 migration ではないため migrate では入らない）。
  await db.admin.query(
    readFileSync(
      join(__dirname, "../../src/infrastructure/database/sql/m0_probe.sql"),
      "utf8",
    ),
  );
  await db.admin.query("GRANT USAGE ON SCHEMA infra TO app_runtime");
  await db.admin.query(
    "GRANT SELECT, INSERT, UPDATE ON infra.m0_probes TO app_runtime",
  );

  AUTH_ENV.DATABASE_URL = db.urlFor("app_runtime");
  for (const [key, value] of Object.entries(AUTH_ENV)) {
    process.env[key] = value;
  }

  runtimePool = getPool();
  // DB 停止試験（A-18）でアイドル接続が切られたとき Pool が投げる error イベントを握る
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
  // ctx.test は testUtils プラグインの init が差し込む。プラグインを経由しない
  // Auth<BetterAuthOptions> の型には表れないため、ここで絞り込む。
  testHelpers = ((await auth.$context) as unknown as { test: TestHelpers })
    .test;

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = await createHttpTestApp(moduleRef, auth);

  hinata = { userId: "", name: "ひなた", email: "hinata@example.test", sub: "test-sub-0" };
  hinata.userId = await insertUser(hinata.name, hinata.email);
  await insertGoogleAccount(hinata.userId, hinata.sub);
  await insertAllowlist(0, hinata.userId, hinata.sub);

  aoi = { userId: "", name: "あおい", email: "aoi@example.test", sub: "test-sub-1" };
  aoi.userId = await insertUser(aoi.name, aoi.email);
  await insertGoogleAccount(aoi.userId, aoi.sub);
  await insertAllowlist(1, aoi.userId, aoi.sub);
}, 120_000);

afterAll(async () => {
  await app?.close();
  await closePool();
  await db?.stop();
  for (const key of Object.keys(AUTH_ENV)) {
    delete process.env[key];
  }
});

describe("H: 実 HTTP と Better Auth の配線", () => {
  it("H-01: POST /api/auth/sign-in/social が 200 と Google の認可 URL を返す", async () => {
    const response = await http()
      .post("/api/auth/sign-in/social")
      .set("Origin", ORIGIN)
      .set("Content-Type", "application/json")
      .send({ provider: "google", callbackURL: "/" });

    expect(response.status).toBe(200);
    expect(response.body.url).toContain("accounts.google.com");
    expect(response.headers.location).toBe(response.body.url);
  });

  it("H-01b: body 検査違反は 400", async () => {
    const response = await http()
      .post("/api/auth/sign-in/social")
      .set("Origin", ORIGIN)
      .set("Content-Type", "application/json")
      .send({ provider: "apple" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      code: "INVALID_REQUEST",
      message: "Invalid sign-in request",
    });
  });

  it("H-01c: JSON 以外の Content-Type は 415 で { code, message } を返す", async () => {
    const response = await http()
      .post("/api/auth/sign-in/social")
      .set("Origin", ORIGIN)
      .set("Content-Type", "text/plain")
      .send("provider=google");

    expect(response.status).toBe(415);
    expect(response.body).toEqual({
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "Content-Type must be application/json",
    });
  });

  it("H-02: 不正な state の callback は /sign-in?error=… へリダイレクトする", async () => {
    const response = await http().get(
      "/api/auth/callback/google?state=bogus-state&code=bogus-code",
    );

    expectSignInRedirect(response);
  });

  it("H-04: 未登録アカウントの callback は 302 で /sign-in?error=… へ戻る", async () => {
    const restore = stubGoogleTokenEndpoint({
      sub: "unregistered-sub",
      email: "outsider@example.test",
      name: "外部の人",
    });
    try {
      const { state, cookie } = await startGoogleSignIn();
      const response = await http()
        .get(`/api/auth/callback/google?state=${state}&code=fake-code`)
        .set("Cookie", cookie);

      expectSignInRedirect(response);
      const location = response.headers.location as string;
      expect(location).not.toContain("unregistered-sub");
      expect(location).not.toContain("outsider%40example.test");
      expect(location).not.toContain("outsider@example.test");
      expectNoSecretsInLocation(response);
    } finally {
      restore();
    }
  });

  it("H-05: 許可リスト外アカウントの callback は 302 で /sign-in?error=… へ戻り、セッション行は残らない", async () => {
    const sotaId = await insertUser("そうた", "sota-callback@example.test");
    await insertGoogleAccount(sotaId, "test-sub-denied");
    const restore = stubGoogleTokenEndpoint({
      sub: "test-sub-denied",
      email: "sota-callback@example.test",
      name: "そうた",
    });
    try {
      const { state, cookie } = await startGoogleSignIn();
      const response = await http()
        .get(`/api/auth/callback/google?state=${state}&code=fake-code`)
        .set("Cookie", cookie);

      expectSignInRedirect(response);
      const location = response.headers.location as string;
      expect(location).not.toContain("test-sub-denied");
      expect(location).not.toContain("sota-callback%40example.test");
      expect(location).not.toContain("sota-callback@example.test");
      expectNoSecretsInLocation(response);
      expect(await sessionCount(sotaId)).toBe(0);
    } finally {
      restore();
    }
  });

  it("H-06: body の errorCallbackURL / newUserCallbackURL は 400", async () => {
    for (const extra of [
      { errorCallbackURL: "http://evil.example.test/" },
      { newUserCallbackURL: "http://evil.example.test/" },
    ]) {
      const response = await http()
        .post("/api/auth/sign-in/social")
        .set("Origin", ORIGIN)
        .set("Content-Type", "application/json")
        .send({ provider: "google", callbackURL: "/", ...extra });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        code: "INVALID_REQUEST",
        message: "Invalid sign-in request",
      });
    }
  });

  it("H-07: GET /api/auth/error は 404", async () => {
    const response = await http().get("/api/auth/error?error=access_denied");

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: "NOT_FOUND" });
  });

  it("H-03: sign-out は session_token の失効 Set-Cookie を返す", async () => {
    const cookie = await login(hinata.userId);
    const response = await http()
      .post("/api/auth/sign-out")
      .set("Origin", ORIGIN)
      .set("Cookie", cookie);

    expect(response.status).toBe(200);
    const setCookies = response.headers["set-cookie"];
    const list = Array.isArray(setCookies)
      ? setCookies
      : setCookies === undefined
        ? []
        : [setCookies];
    const clears = list.filter(
      (value) =>
        value.startsWith(`${SESSION_COOKIE}=`) &&
        (value.includes("Max-Age=0") || /Expires=Thu, 01 Jan 1970/.test(value)),
    );
    expect(clears.length).toBeGreaterThan(0);
  });
});

describe("A: 許可リストとセッションの保護", () => {
  it("A-01: 許可された二人とも /api/me が 200 で自分の情報を返す", async () => {
    for (const user of [hinata, aoi]) {
      const cookie = await login(user.userId);
      const response = await authed(http().get("/api/me"), cookie);

      expect(response.status).toBe(200);
      expect(response.body.user).toEqual({
        id: user.userId,
        displayName: user.name,
      });
      expect(
        Date.parse(response.body.sessionExpiresAt),
      ).toBeGreaterThan(Date.now());
    }
  });

  it("A-02: 許可リストに無い第三者はセッションを発行されず行も残らない", async () => {
    const sotaId = await insertUser("そうた", "sota@example.test");
    await insertGoogleAccount(sotaId, "test-sub-third");

    await expect(testHelpers.login({ userId: sotaId })).rejects.toThrow();
    expect(await sessionCount(sotaId)).toBe(0);
  });

  it("A-03: enabled=false では発行されない", async () => {
    await db.admin.query(
      "UPDATE identity.allowed_google_accounts SET enabled = FALSE WHERE user_id = $1",
      [aoi.userId],
    );
    const before = await sessionCount(aoi.userId);
    try {
      await expect(testHelpers.login({ userId: aoi.userId })).rejects.toThrow();
      expect(await sessionCount(aoi.userId)).toBe(before);
    } finally {
      await db.admin.query(
        "UPDATE identity.allowed_google_accounts SET enabled = TRUE WHERE user_id = $1",
        [aoi.userId],
      );
    }
  });

  it("A-04: allowlist の sub と account が一致しないと発行されない", async () => {
    await db.admin.query(
      "UPDATE identity.allowed_google_accounts SET google_sub = 'other-sub' WHERE user_id = $1",
      [aoi.userId],
    );
    const before = await sessionCount(aoi.userId);
    try {
      await expect(testHelpers.login({ userId: aoi.userId })).rejects.toThrow();
      expect(await sessionCount(aoi.userId)).toBe(before);
    } finally {
      await db.admin.query(
        "UPDATE identity.allowed_google_accounts SET google_sub = $2 WHERE user_id = $1",
        [aoi.userId, aoi.sub],
      );
    }
  });

  it("A-05: 発行後に許可停止すると 403", async () => {
    const cookie = await login(aoi.userId);
    await expect(authed(http().get("/api/me"), cookie)).resolves.toMatchObject({
      status: 200,
    });

    await db.admin.query(
      "UPDATE identity.allowed_google_accounts SET enabled = FALSE WHERE user_id = $1",
      [aoi.userId],
    );
    try {
      const response = await authed(http().get("/api/me"), cookie);
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ code: "FORBIDDEN_NOT_ALLOWED" });
    } finally {
      await db.admin.query(
        "UPDATE identity.allowed_google_accounts SET enabled = TRUE WHERE user_id = $1",
        [aoi.userId],
      );
    }
  });

  it("A-06: 発行後に sub が変わると 403", async () => {
    const cookie = await login(aoi.userId);
    await db.admin.query(
      "UPDATE identity.allowed_google_accounts SET google_sub = 'changed-sub' WHERE user_id = $1",
      [aoi.userId],
    );
    try {
      const response = await authed(http().get("/api/me"), cookie);
      expect(response.status).toBe(403);
    } finally {
      await db.admin.query(
        "UPDATE identity.allowed_google_accounts SET google_sub = $2 WHERE user_id = $1",
        [aoi.userId, aoi.sub],
      );
    }
  });

  it("A-07: Cookie なし・偽造・署名違いはすべて 401", async () => {
    const cookie = await login(hinata.userId);

    const noCookie = await http().get("/api/me");
    expect(noCookie.status).toBe(401);
    expect(noCookie.body).toMatchObject({ code: "UNAUTHENTICATED" });

    const forged = await authed(
      http().get("/api/me"),
      `${SESSION_COOKIE}=forged-value.forgedsig`,
    );
    expect(forged.status).toBe(401);

    const tampered = await authed(
      http().get("/api/me"),
      cookie.replace(/.$/, (last) => (last === "a" ? "b" : "a")),
    );
    expect(tampered.status).toBe(401);
  });

  it("A-08: 期限切れのセッションは 401", async () => {
    const cookie = await login(hinata.userId);
    await db.admin.query(
      "UPDATE identity.sessions SET expires_at = now() - interval '1 hour' WHERE user_id = $1",
      [hinata.userId],
    );

    const response = await authed(http().get("/api/me"), cookie);
    expect(response.status).toBe(401);
  });

  it("A-09: 期限ちょうどのセッションは 401", async () => {
    const cookie = await login(hinata.userId);
    await db.admin.query(
      "UPDATE identity.sessions SET expires_at = now() WHERE user_id = $1",
      [hinata.userId],
    );

    const response = await authed(http().get("/api/me"), cookie);
    expect(response.status).toBe(401);
  });

  it("A-10: 7 日期限・要求ごとに延長しない", async () => {
    const cookie = await login(aoi.userId);
    const issued = await sessionExpiresAt(aoi.userId);
    const expectedMs = 7 * 24 * 60 * 60 * 1000;
    expect(issued.getTime() - Date.now()).toBeGreaterThan(expectedMs - 60_000);
    expect(issued.getTime() - Date.now()).toBeLessThanOrEqual(expectedMs);

    await authed(http().get("/api/me"), cookie);
    await authed(http().get("/api/me"), cookie);
    expect(await sessionExpiresAt(aoi.userId)).toEqual(issued);
  });

  it("A-11: sign-out するとセッション行が消え以後 401", async () => {
    const cookie = await login(hinata.userId);
    const before = await sessionCount(hinata.userId);
    expect(before).toBeGreaterThan(0);

    const signOut = await http()
      .post("/api/auth/sign-out")
      .set("Origin", ORIGIN)
      .set("Cookie", cookie);
    expect(signOut.status).toBe(200);

    expect(await sessionCount(hinata.userId)).toBe(before - 1);
    const after = await authed(http().get("/api/me"), cookie);
    expect(after.status).toBe(401);
  });

  it("A-12: セッションなしの sign-out も 200 で Cookie を消す", async () => {
    const response = await http()
      .post("/api/auth/sign-out")
      .set("Origin", ORIGIN);

    expect(response.status).toBe(200);
    const setCookies = response.headers["set-cookie"];
    const list = Array.isArray(setCookies)
      ? setCookies
      : setCookies === undefined
        ? []
        : [setCookies];
    expect(
      list.some((value) => value.startsWith(`${SESSION_COOKIE}=`)),
    ).toBe(true);
  });

  it("A-13: 別 Origin の sign-out は 403 でセッションは残る", async () => {
    const cookie = await login(aoi.userId);
    const before = await sessionCount(aoi.userId);

    const response = await http()
      .post("/api/auth/sign-out")
      .set("Origin", EVIL_ORIGIN)
      .set("Cookie", cookie);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
    expect(await sessionCount(aoi.userId)).toBe(before);

    const me = await authed(http().get("/api/me"), cookie);
    expect(me.status).toBe(200);
  });

  it("A-14: foundation はログイン必須（401 / 200）", async () => {
    const denied = await http().get("/api/foundation/probes");
    expect(denied.status).toBe(401);

    const cookie = await login(hinata.userId);
    const allowed = await authed(http().get("/api/foundation/probes"), cookie);
    expect(allowed.status).toBe(200);
    expect(allowed.body).toEqual({ count: expect.any(Number) });
  });

  it("A-15: /api/health は公開", async () => {
    const response = await http().get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("A-16: /api/me の応答に sub・メール・token を含まない", async () => {
    const cookie = await login(hinata.userId);
    const response = await authed(http().get("/api/me"), cookie);

    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual([
      "sessionExpiresAt",
      "user",
    ]);
    expect(Object.keys(response.body.user).sort()).toEqual([
      "displayName",
      "id",
    ]);
    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain(hinata.sub);
    expect(raw).not.toContain(hinata.email);
    expect(raw).not.toContain("token");
  });

  it("A-17: セッション発行後も accounts の token 列は null", async () => {
    await login(aoi.userId);
    const result = await db.admin.query<{
      access_token: string | null;
      refresh_token: string | null;
      id_token: string | null;
    }>(
      `SELECT access_token, refresh_token, id_token
         FROM identity.accounts WHERE user_id = $1`,
      [aoi.userId],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({
      access_token: null,
      refresh_token: null,
      id_token: null,
    });
  });

  it("A-19: プロフィール変更後も同じ user.id", async () => {
    const before = await login(hinata.userId);
    const meBefore = await authed(http().get("/api/me"), before);
    const idBefore = meBefore.body.user.id;

    await db.admin.query(
      "UPDATE identity.users SET name = 'ひなた（変更後）' WHERE id = $1",
      [hinata.userId],
    );
    const after = await login(hinata.userId);
    const meAfter = await authed(http().get("/api/me"), after);
    expect(meAfter.status).toBe(200);
    expect(meAfter.body.user.id).toBe(idBefore);
    expect(meAfter.body.user.displayName).toBe("ひなた（変更後）");

    await db.admin.query("UPDATE identity.users SET name = $2 WHERE id = $1", [
      hinata.userId,
      hinata.name,
    ]);
  });
});

describe("A-18: DB 停止中は 503 で Set-Cookie を出さない", () => {
  it("container restart で検証して復帰する", async () => {
    const cookie = await login(hinata.userId);
    // remove:false を付けないと stop がコンテナを消し restart できない
    await db.container.stop({ remove: false });

    try {
      const response = await authed(http().get("/api/me"), cookie);
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({ code: "AUTH_UNAVAILABLE" });
      expect(response.headers["set-cookie"]).toBeUndefined();
    } finally {
      // Docker は restart でホスト側の ephemeral ポートを振り直す（stop/start で
      // 32776→32777 になることを確認済み）。pg Pool は接続ごとに
      // options.connectionString を parse するので、既存 pool の接続先を
      // 新しい URL に向け直す。
      await db.container.restart();
      const repoint = (pool: Pool, url: string): void => {
        (pool as unknown as { options: { connectionString: string } }).options
          .connectionString = url;
      };
      repoint(runtimePool, db.urlFor("app_runtime"));
      repoint(db.admin, db.container.getConnectionUri());
    }

    // 再起動直後は接続が張り直され、pool 内の死んだクライアントが
    // 取り除かれるまで待つ（初回の /api/me は古い接続で落ちることがある）。
    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        await db.admin.query("SELECT 1");
        const recovered = await authed(http().get("/api/me"), cookie);
        if (recovered.status === 200) {
          break;
        }
      } catch (error) {
        if (Date.now() > deadline) {
          throw error;
        }
      }
      if (Date.now() > deadline) {
        throw new Error("DB の復帰待ちがタイムアウトした");
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }, 120_000);
});
