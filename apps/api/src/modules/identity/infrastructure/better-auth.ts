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
  /** 公開アプリのオリジン（= baseURL。Nextのrewriteで同一オリジンに見える前置きを使う）。 */
  baseURL: string;
  secret: string;
  googleClientId: string;
  googleClientSecret: string;
  useSecureCookies: boolean;
};

/**
 * テストだけが渡す追加設定。`testUtils`プラグインはここからしか入らない
 * （本番設定に混ぜない。apps/api/src/** からbetter-auth/pluginsはESLintが塞ぐ）。
 */
export type AuthOverrides = Pick<BetterAuthOptions, "plugins">;

// 公開するのは3経路だけ（設計書「API設計」）。残りの既知経路をBetter Auth側でも止める。
// 主の防御はbootstrap/auth-route-allowlistで、こちらは二重防御。
const DISABLED_PATHS = [
  "/account-info",
  "/change-email",
  "/change-password",
  "/delete-user",
  "/delete-user/callback",
  "/error",
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

// エラーbodyはcontractsのErrorスキーマ（codeと一般的なmessage）に揃える。
// messageに入力値や内部情報を含めない。
const INVALID_REQUEST_ERROR = {
  code: "INVALID_REQUEST",
  message: "Invalid sign-in request",
} as const;
const UNSUPPORTED_MEDIA_TYPE_ERROR = {
  code: "UNSUPPORTED_MEDIA_TYPE",
  message: "Content-Type must be application/json",
} as const;

// better-authの内部ロガーは例外オブジェクトをそのまま出力し、DBエラー時に
// query params（= セッションtokenなど）がstderrに流れる。ログに秘密を出さない
// 完了条件のため、messageだけをpinoに流しargsは捨てる。
const internalLogger = pino({ name: "better-auth" });

/**
 * sign-in/socialのbody検査（U-15）。providerはgoogle固定、
 * idToken持ち込みと固定以外のcallbackURLは拒否する。
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
  // 失敗時・新規登録時の戻り先はサーバー側の設定（onAPIError.errorURL）だけで決める。
  // クライアントから受け取るとopen redirectになるため、値の指定自体を拒否する。
  if (body.errorCallbackURL !== undefined && body.errorCallbackURL !== null) {
    throw new APIError("BAD_REQUEST", { ...INVALID_REQUEST_ERROR });
  }
  if (body.newUserCallbackURL !== undefined && body.newUserCallbackURL !== null) {
    throw new APIError("BAD_REQUEST", { ...INVALID_REQUEST_ERROR });
  }
});

/**
 * better-callが返す415のbodyは受け取ったContent-Typeの値をmessageに含める。
 * onResponseでbodyを差し替え、codeと一般的なmessageだけにする。
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
 * betterAuth()を生成する唯一の場所。生成したインスタンスはgetAuth()で
 * IdentityModuleのproviderからも参照する（authはDI管理外で生成するため）。
 */
export function createAuth(
  config: AuthConfig,
  pool: Pool,
  options?: AuthOverrides,
): Auth {
  const db = drizzle(pool, { schema: identitySchema });
  // BetterAuthOptionsとして明示しないとAuth<具体オプション> になり、
  // Auth (= Auth<BetterAuthOptions>)へ代入できない（genericは不変）。
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
    // OAuth失敗時の戻り先。ライブラリが ?error=… を付けて302し、webの /sign-inが表示する
    onAPIError: { errorURL: `${config.baseURL}/sign-in` },
    hooks: { before: signInSocialBodyCheck },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            // falseを返すとライブラリ側で発行がロールバックされる（E-02、E-05）。
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

/** createAuthがまだ呼ばれていない / DATABASE_URLが無いときはnull。 */
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
 * DATABASE_URLが無いときはauthを生成しない（認証経路とGuardは503）。
 * DATABASE_URLがあるのに必須の認証用環境変数が無いのは設定ミスなので起動時に失敗させる。
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
