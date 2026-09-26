import {
  betterAuth,
  type Auth,
  type BetterAuthOptions,
  type BetterAuthPlugin,
} from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import pino from "pino";
import { getPool } from "../../../infrastructure/database/pool";
import * as identitySchema from "../../../infrastructure/database/schema/identity";
import { isAllowedGoogleAccount } from "./allowlist-query";

export type AuthConfig = {
  /** 公開アプリのオリジン（= baseURL。Next の rewrite で同一オリジンに見える前置きを使う）。 */
  baseURL: string;
  secret: string;
  googleClientId: string;
  googleClientSecret: string;
  useSecureCookies: boolean;
};

/**
 * テストだけが渡す追加設定。`testUtils` プラグインはここからしか入らない
 * （本番設定に混ぜない。apps/api/src/** から better-auth/plugins は ESLint が塞ぐ）。
 */
export type AuthOverrides = Pick<BetterAuthOptions, "plugins">;

// 公開するのは 4 経路だけ（設計書「API 設計」）。残りの既知経路を Better Auth 側でも止める。
// 主の防御は bootstrap/auth-route-allowlist で、こちらは二重防御。
const DISABLED_PATHS = [
  "/account-info",
  "/change-email",
  "/change-password",
  "/delete-user",
  "/delete-user/callback",
  "/get-access-token",
  "/get-session",
  "/link-social",
  "/list-accounts",
  "/list-sessions",
  "/ok",
  "/refresh-token",
  "/request-password-reset",
  "/reset-password",
  "/revoke-other-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/send-verification-email",
  "/sign-in/email",
  "/sign-up/email",
  "/unlink-account",
  "/update-session",
  "/update-user",
  "/verify-email",
  "/verify-password",
] as const;

const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;

// エラー body は contracts の Error スキーマ（code と一般的な message）に揃える。
// message に入力値や内部情報を含めない。
const INVALID_REQUEST_ERROR = {
  code: "INVALID_REQUEST",
  message: "Invalid sign-in request",
} as const;
const UNSUPPORTED_MEDIA_TYPE_ERROR = {
  code: "UNSUPPORTED_MEDIA_TYPE",
  message: "Content-Type must be application/json",
} as const;

// better-auth の内部ロガーは例外オブジェクトをそのまま出力し、DB エラー時に
// query params（= セッション token など）が stderr に流れる。ログに秘密を出さない
// 完了条件のため、message だけを pino に流し args は捨てる。
const internalLogger = pino({ name: "better-auth" });

/**
 * sign-in/social の body 検査（U-15）。provider は google 固定、
 * idToken 持ち込みと固定以外の callbackURL は拒否する。
 */
const signInSocialBodyCheck = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== "/sign-in/social") {
    return;
  }
  const body = (typeof ctx.body === "object" && ctx.body !== null
    ? ctx.body
    : {}) as Record<string, unknown>;
  if (body.provider !== "google") {
    throw new APIError("BAD_REQUEST", { ...INVALID_REQUEST_ERROR });
  }
  if (body.idToken !== undefined && body.idToken !== null) {
    throw new APIError("BAD_REQUEST", { ...INVALID_REQUEST_ERROR });
  }
  if (body.callbackURL !== undefined && body.callbackURL !== "/") {
    throw new APIError("BAD_REQUEST", { ...INVALID_REQUEST_ERROR });
  }
});

/**
 * better-call が返す 415 の body は受け取った Content-Type の値を message に含める。
 * onResponse で body を差し替え、code と一般的な message だけにする。
 */
const unsupportedMediaTypeBody: BetterAuthPlugin = {
  id: "tomotabi-unsupported-media-type-body",
  onResponse: async (response) => {
    if (response.status !== 415) {
      return;
    }
    return {
      response: new Response(JSON.stringify(UNSUPPORTED_MEDIA_TYPE_ERROR), {
        status: 415,
        headers: { "Content-Type": "application/json" },
      }),
    };
  },
};

let currentAuth: Auth | null = null;

/**
 * betterAuth() を生成する唯一の場所。生成したインスタンスは getAuth() で
 * IdentityModule の provider からも参照する（auth は DI 管理外で生成するため）。
 */
export function createAuth(
  config: AuthConfig,
  pool: Pool,
  options?: AuthOverrides,
): Auth {
  const db = drizzle(pool, { schema: identitySchema });
  // BetterAuthOptions として明示しないと Auth<具体オプション> になり、
  // Auth (= Auth<BetterAuthOptions>) へ代入できない（generic は不変）。
  const authOptions: BetterAuthOptions = {
    baseURL: config.baseURL,
    basePath: "/api/auth",
    trustedOrigins: [config.baseURL],
    secret: config.secret,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: identitySchema,
    }),
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
        disableSignUp: true,
        disableImplicitSignUp: true,
      },
    },
    user: { modelName: "users" },
    session: {
      modelName: "sessions",
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    account: {
      modelName: "accounts",
      updateAccountOnSignIn: false,
      accountLinking: { enabled: false, disableImplicitLinking: true },
    },
    verification: { modelName: "verifications" },
    advanced: {
      cookiePrefix: "travel",
      useSecureCookies: config.useSecureCookies,
      database: { generateId: "uuid" },
    },
    disabledPaths: [...DISABLED_PATHS],
    hooks: { before: signInSocialBodyCheck },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            // false を返すとライブラリ側で発行がロールバックされる（E-02、E-05）。
            if (!(await isAllowedGoogleAccount(pool, session.userId))) {
              return false;
            }
          },
        },
      },
    },
    plugins: [unsupportedMediaTypeBody, ...(options?.plugins ?? [])],
    logger: {
      log: (level, message) => {
        internalLogger[level](message);
      },
    },
  };
  const auth = betterAuth(authOptions);
  currentAuth = auth;
  return auth;
}

/** createAuth がまだ呼ばれていない / DATABASE_URL が無いときは null。 */
export function getAuth(): Auth | null {
  return currentAuth;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required when DATABASE_URL is set`);
  }
  return value;
}

/**
 * DATABASE_URL が無いときは auth を生成しない（認証経路と Guard は 503）。
 * DATABASE_URL があるのに必須の認証用環境変数が無いのは設定ミスなので起動時に失敗させる。
 */
export function createAuthFromEnv(): Auth | null {
  if (!process.env.DATABASE_URL) {
    return null;
  }
  return createAuth(
    {
      baseURL: requiredEnv("PUBLIC_APP_ORIGIN"),
      secret: requiredEnv("BETTER_AUTH_SECRET"),
      googleClientId: requiredEnv("GOOGLE_CLIENT_ID"),
      googleClientSecret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      useSecureCookies: process.env.NODE_ENV === "production",
    },
    getPool(),
  );
}
