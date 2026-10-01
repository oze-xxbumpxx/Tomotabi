import type { Browser, BrowserContext } from "@playwright/test";
import type { Auth } from "better-auth";
import type { TestHelpers } from "better-auth/plugins";
import { testUtils } from "better-auth/plugins";
import { Pool } from "pg";
import { createAuth } from "../../apps/api/src/modules/identity/infrastructure/better-auth";
import { AUTH_SECRET, RUNTIME_DATABASE_URL, WEB_ORIGIN } from "./env";

/**
 * Playwright 側で testUtils を使ってセッションを作る。API に試験用の
 * 経路は足さない（ADR-0005 Decision 2）。`createAuth` は API と同じ
 * `BETTER_AUTH_SECRET`・同じ DB（app_runtime）で組み立てる。
 */
let helpersPromise: Promise<TestHelpers> | null = null;
let authPool: Pool | null = null;

function authHelpers(): Promise<TestHelpers> {
  helpersPromise ??= (async () => {
    authPool = new Pool({ connectionString: RUNTIME_DATABASE_URL });
    authPool.on("error", () => {});
    const auth: Auth = createAuth(
      {
        baseURL: WEB_ORIGIN,
        secret: AUTH_SECRET,
        googleClientId: "e2e-unused",
        googleClientSecret: "e2e-unused",
        useSecureCookies: false,
      },
      authPool,
      { plugins: [testUtils()] },
    );
    const context = await auth.$context;
    return (context as unknown as { test: TestHelpers }).test;
  })();
  return helpersPromise;
}

async function sessionCookies(userId: string) {
  const helpers = await authHelpers();
  const result = await helpers.login({ userId });
  const header = result.headers.get("cookie");
  if (header === null) {
    throw new Error("testHelpers.login did not return a cookie");
  }
  // `name=value` の組が "; " 区切りで並ぶ（Cookie ヘッダーの形式）。
  return header.split(/;\s*/).map((pair) => {
    const separator = pair.indexOf("=");
    if (separator <= 0) {
      throw new Error(`unexpected cookie format: ${pair}`);
    }
    return {
      name: pair.slice(0, separator),
      value: pair.slice(separator + 1),
      url: WEB_ORIGIN,
      httpOnly: true,
      sameSite: "Lax" as const,
    };
  });
}

/**
 * 利用者のセッション Cookie を入れたブラウザの context を返す。
 * 試験ごとに呼ぶ（M-03 のログアウトでセッションが消えるため）。
 */
export async function newLoggedInContext(
  browser: Browser,
  userId: string,
): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addCookies(await sessionCookies(userId));
  return context;
}
