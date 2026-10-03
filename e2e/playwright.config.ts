import { defineConfig } from "@playwright/test";
import {
  API_ORIGIN,
  API_PORT,
  AUTH_SECRET,
  RUNTIME_DATABASE_URL,
  SKIP_BUILD,
  WEB_ORIGIN,
  WEB_PORT,
} from "./support/env";

// DB（Testcontainers）と環境変数はscripts/run.mjsが用意する。
// webServerはglobal setupより先に起動するため、DBの起動はここではなく
// run.mjsで行う（ADR-0005 Decision 4）。
const buildIfNeeded = (script: string): string =>
  SKIP_BUILD ? "" : `npm run ${script} && `;

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
  ],
  use: {
    baseURL: WEB_ORIGIN,
    browserName: "chromium",
    // v3の基準のモバイル幅（375×812）。クリックはtapではなくclickを使う。
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      name: "api",
      command: `${buildIfNeeded("build")}node dist/main.js`,
      cwd: "../apps/api",
      url: `${API_ORIGIN}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
      env: {
        DATABASE_URL: RUNTIME_DATABASE_URL,
        PORT: String(API_PORT),
        PUBLIC_APP_ORIGIN: WEB_ORIGIN,
        BETTER_AUTH_SECRET: AUTH_SECRET,
        GOOGLE_CLIENT_ID: "e2e-unused",
        GOOGLE_CLIENT_SECRET: "e2e-unused",
      },
    },
    {
      name: "web",
      // rewritesの転送先はnext buildのときにAPI_ORIGINで決まるため、
      // buildに必ずAPI_ORIGINを渡す（設計書「データフロー」）。
      command: `${buildIfNeeded("build")}npx next start -p ${WEB_PORT}`,
      cwd: "../apps/web",
      url: `${WEB_ORIGIN}/sign-in`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
      env: { API_ORIGIN },
    },
  ],
});
