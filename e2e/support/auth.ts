import type { Browser, BrowserContext, Page } from "@playwright/test";
import type { Auth } from "better-auth";
import type { TestHelpers } from "better-auth/plugins";
import { testUtils } from "better-auth/plugins";
import { Pool } from "pg";
import { createAuth } from "../../apps/api/src/modules/identity/infrastructure/better-auth";
import { AUTH_SECRET, RUNTIME_DATABASE_URL, WEB_ORIGIN } from "./env";

/**
 * Playwright側でtestUtilsを使ってセッションを作る。APIに試験用の
 * 経路は足さない（ADR-0005 Decision 2）。`createAuth`はAPIと同じ
 * `BETTER_AUTH_SECRET`・同じDB（app_runtime）で組み立てる。
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
  // `name=value`の組が"; "区切りで並ぶ（Cookieヘッダーの形式）。
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
 * 利用者のセッションCookieを入れたブラウザのcontextを返す。
 * 試験ごとに呼ぶ（M-03のログアウトでセッションが消えるため）。
 */
export async function newLoggedInContext(
  browser: Browser,
  userId: string,
): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addCookies(await sessionCookies(userId));
  return context;
}

/**
 * 既存のpageのcontextに、新しいセッションのCookieを入れ直す
 * （M-03の再ログイン）。localStorageは残るため、ログアウトで
 * 「前回の旅行」の保存値が消えたことも確かめられる。
 */
export async function addSessionCookies(
  page: Page,
  userId: string,
): Promise<void> {
  await page.context().addCookies(await sessionCookies(userId));
}
