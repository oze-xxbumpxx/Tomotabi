import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  createAuth,
  createAuthFromEnv,
  type AuthConfig,
} from "../../src/modules/identity/infrastructure/better-auth";

const CONFIG: AuthConfig = {
  baseURL: "http://localhost:3000",
  secret: "test-secret-for-unit-tests-only",
  googleClientId: "test-google-client-id",
  googleClientSecret: "test-google-client-secret",
  useSecureCookies: false,
};

// 拒否系は body 検査が DB より先に走るため、繋がらない Pool で良い。
// 受理系（DB に state を書く）は tests/db/auth-http.db.test.ts が実 DB で見る。
const UNREACHABLE_POOL = () =>
  new Pool({ connectionString: "postgres://127.0.0.1:1/nowhere" });

describe("createAuth の設定", () => {
  it("公開 4 経路以外の core endpoint を disabledPaths で塞ぐ", () => {
    const auth = createAuth(CONFIG, UNREACHABLE_POOL());
    const disabled = new Set(auth.options.disabledPaths ?? []);

    expect(auth.options.basePath).toBe("/api/auth");
    for (const path of [
      "/get-session",
      "/list-sessions",
      "/list-accounts",
      "/sign-in/email",
      "/sign-up/email",
      "/delete-user",
      "/update-user",
      "/link-social",
      "/change-password",
    ]) {
      expect(disabled.has(path), `disabledPaths should contain ${path}`).toBe(
        true,
      );
    }
    // 公開経路は塞がない
    for (const path of [
      "/sign-in/social",
      "/callback/:id",
      "/sign-out",
      "/error",
    ]) {
      expect(disabled.has(path)).toBe(false);
    }
  });

  it("許可なし新規登録・自動延長なし・Cookie 接頭辞 travel を設定する", () => {
    const auth = createAuth(CONFIG, UNREACHABLE_POOL());

    expect(auth.options.socialProviders).toHaveProperty("google");
    expect(auth.options.emailAndPassword?.enabled).toBe(false);
    expect(auth.options.session?.expiresIn).toBe(60 * 60 * 24 * 7);
    expect(auth.options.session?.disableSessionRefresh).toBe(true);
    expect(auth.options.session?.cookieCache?.enabled).toBe(false);
    expect(auth.options.advanced?.cookiePrefix).toBe("travel");
    expect(auth.options.account?.updateAccountOnSignIn).toBe(false);
    expect(auth.options.account?.accountLinking?.enabled).toBe(false);
  });
});

describe("sign-in/social の body 検査 (U-15)", () => {
  const auth = createAuth(CONFIG, UNREACHABLE_POOL());

  it.each([
    [{ provider: "apple" }, "provider が google 以外"],
    [{ provider: "github", callbackURL: "/" }, "provider が google 以外"],
    [
      { provider: "google", idToken: { token: "forged-id-token" } },
      "idToken の持ち込み",
    ],
    [
      { provider: "google", callbackURL: "http://evil.example.test" },
      "callbackURL が外部 URL",
    ],
    [
      { provider: "google", callbackURL: "/dashboard" },
      "callbackURL が / 以外",
    ],
  ])("rejects with BAD_REQUEST: %j (%s)", async (body, _reason) => {
    await expect(auth.api.signInSocial({ body })).rejects.toMatchObject({
      name: "APIError",
      status: "BAD_REQUEST",
    });
  });
});

describe("createAuthFromEnv", () => {
  it("DATABASE_URL が無いときは auth を作らず null を返す", () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(createAuthFromEnv()).toBeNull();
    } finally {
      if (saved !== undefined) {
        process.env.DATABASE_URL = saved;
      }
    }
  });

  it("DATABASE_URL があるのに認証用の環境変数が無いと起動時に失敗する", () => {
    const saved = {
      DATABASE_URL: process.env.DATABASE_URL,
      PUBLIC_APP_ORIGIN: process.env.PUBLIC_APP_ORIGIN,
    };
    process.env.DATABASE_URL = "postgres://127.0.0.1:1/nowhere";
    delete process.env.PUBLIC_APP_ORIGIN;
    try {
      expect(() => createAuthFromEnv()).toThrow(/PUBLIC_APP_ORIGIN/);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});
