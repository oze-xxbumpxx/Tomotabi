// 手動確認（PM-01・PM-02）の起動スクリプト（Issue #205）。
// `npm run manual:push` で使う。
// 1. TestcontainersのPostgreSQLを起動し、run.mjsと同じ手順で
//    ロール・migration・二人（ひなた・あおい）のseedを入れる
// 2. 実行ごとのVAPIDの鍵をAPIに渡してAPI・webを起動する
//    （鍵はファイルやリポジトリに残さない。portsはdevと同じ3000/3001）
// 3. apps/apiのbuild成果物のcreateAuth＋testUtilsで二人のログイン
//    済みセッションCookieを作る
// 4. 別々のプロファイルの実Chrome（見える画面・channel:"chrome"）を
//    2つ開き、ひなたで旅行を1つ作って両方の画面に出す
// 5. Ctrl-Cですべて（Chrome・API・web・DBコンテナ）止める
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { testUtils } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { generateVapidKeyElement } from "./vapid-keys.mjs";

const E2E_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(E2E_DIR, "..");
const API_ROOT = join(REPO_ROOT, "apps/api");
const WEB_ROOT = join(REPO_ROOT, "apps/web");
const MIGRATIONS_FOLDER = join(API_ROOT, "drizzle");

// apps/api/tests/support/database.tsのROLE_PASSWORDSと同じ値。
const ROLE_PASSWORDS = {
  migrator: "test-migrator",
  app_runtime: "test-app-runtime",
};

// devと同じポート（手動確認なので、普段のdevと重ならない値にする）。
const WEB_PORT = 3000;
const API_PORT = 3001;
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
const API_ORIGIN = `http://localhost:${API_PORT}`;

// run.mjsのTRUNCATEと同じ文。起動時に1度通す。
const TRUNCATE_BUSINESS_TABLES = `TRUNCATE
  planning.plans, planning.trip_participants, planning.trips,
  record.active_plan_events, record.plan_event_cancellations, record.plan_events,
  infra.command_receipts, infra.trip_finance_guards,
  notification.push_subscriptions, notification.closed_push_sessions
  RESTART IDENTITY CASCADE`;

const run = (command, args, options = {}) =>
  spawnSync(command, args, { stdio: "inherit", ...options });

/** urlが200になるまで待つ（最大60秒）。 */
async function waitForOk(url, label) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // 起動前。少し待って再試行。
    }
    if (Date.now() > deadline) {
      throw new Error(`${label}が起動しませんでした: ${url}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * build成果物のcreateAuth＋testUtilsで、userIdのログイン済み
 * セッションCookie（`travel.session_token=...`）を作る。
 * support/auth.tsのsessionCookiesと同じ仕組み。
 */
async function sessionCookies(pool, secret, userId) {
  const { createAuth } = await import(
    pathToFileURL(
      join(API_ROOT, "dist/modules/identity/infrastructure/better-auth.js"),
    ).href
  );
  const auth = createAuth(
    {
      baseURL: WEB_ORIGIN,
      secret,
      googleClientId: "manual-unused",
      googleClientSecret: "manual-unused",
      useSecureCookies: false,
    },
    pool,
    { plugins: [testUtils()] },
  );
  const context = await auth.$context;
  const helpers = context.test;
  const result = await helpers.login({ userId });
  const header = result.headers.get("cookie");
  if (header === null) {
    throw new Error(`session cookie is empty for user ${userId}`);
  }
  // `name=value`の組が"; "区切りで並ぶ（Cookieヘッダーの形式）。
  // 値にも=が入りうるため、最初の=だけで切る（support/auth.tsと同じ）。
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
      sameSite: "Lax",
    };
  });
}

/** Cookieの組をCookieヘッダーの文字列に戻す（旅行の作成のfetch用）。 */
const cookieHeader = (cookies) =>
  cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

async function main() {
  console.log("DB（Testcontainers）を起動しています…");
  const container = await new PostgreSqlContainer("postgres:16-alpine").start();

  const admin = new Pool({ connectionString: container.getConnectionUri() });
  const pools = [admin];
  const urlFor = (role) => {
    const url = new URL(container.getConnectionUri());
    url.username = role;
    url.password = ROLE_PASSWORDS[role];
    return url.toString();
  };
  const poolFor = (role) => {
    const pool = new Pool({ connectionString: urlFor(role) });
    pools.push(pool);
    return pool;
  };

  const children = [];
  const profiles = [];
  const contexts = [];
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    await Promise.allSettled(contexts.map((context) => context.close()));
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGINT");
      }
    }
    await Promise.allSettled(pools.map((pool) => pool.end()));
    await container.stop();
    for (const dir of profiles) {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      void cleanup().finally(() => process.exit(0));
    });
  }

  try {
    // 1. DBの準備（run.mjsと同じ手順）。
    const createRolesSql = readFileSync(
      join(API_ROOT, "db/admin/create-roles.sql"),
      "utf8",
    )
      .replace(":'migrator_password'", `'${ROLE_PASSWORDS.migrator}'`)
      .replace(":'app_runtime_password'", `'${ROLE_PASSWORDS.app_runtime}'`);
    await admin.query(createRolesSql);
    await admin.query(
      readFileSync(join(API_ROOT, "db/admin/grant-database.sql"), "utf8"),
    );
    const migratorPool = poolFor("migrator");
    await migrate(drizzle(migratorPool), {
      migrationsFolder: MIGRATIONS_FOLDER,
    });
    await migratorPool.query(TRUNCATE_BUSINESS_TABLES);
    const { seedUsers } = await import("../support/seed.mts");
    const { hinataUserId, aoiUserId } = await seedUsers(admin);

    // 2. build（APIはdistを動かし、webは本番buildを配る）。
    console.log("buildしています（contracts → api → web）…");
    for (const args of [
      ["run", "build", "-w", "@tomotabi/contracts"],
      ["run", "build", "-w", "@tomotabi/api"],
      ["run", "build", "-w", "@tomotabi/web"],
    ]) {
      const result = run("npm", args, { cwd: REPO_ROOT });
      if (result.status !== 0) {
        throw new Error(`npm ${args.join(" ")} が失敗しました`);
      }
    }

    // 3. API・webを起動する。VAPIDの鍵は実行ごとにメモリ上だけで作る。
    const authSecret = randomBytes(32).toString("hex");
    const api = spawn("node", [join(API_ROOT, "dist/main.js")], {
      cwd: API_ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: urlFor("app_runtime"),
        PORT: String(API_PORT),
        PUBLIC_APP_ORIGIN: WEB_ORIGIN,
        BETTER_AUTH_SECRET: authSecret,
        GOOGLE_CLIENT_ID: "manual-unused",
        GOOGLE_CLIENT_SECRET: "manual-unused",
        VAPID_KEYS: JSON.stringify([generateVapidKeyElement("manual")]),
        VAPID_SUBJECT: "mailto:manual@tomotabi.invalid",
      },
    });
    children.push(api);
    const web = spawn(
      "node",
      [join(REPO_ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(WEB_PORT)],
      { cwd: WEB_ROOT, stdio: "inherit" },
    );
    children.push(web);
    await waitForOk(`${API_ORIGIN}/api/health`, "API");
    await waitForOk(`${WEB_ORIGIN}/sign-in`, "web");

    // 4. 二人のセッションCookieを作る。
    const runtimePool = poolFor("app_runtime");
    const hinataCookies = await sessionCookies(
      runtimePool,
      authSecret,
      hinataUserId,
    );
    const aoiCookies = await sessionCookies(
      runtimePool,
      authSecret,
      aoiUserId,
    );

    // 5. ひなたで旅行を1つ作る（二人は自動で参加者になる）。
    const { daysFromToday } = await import("../support/dates.ts");
    const createResponse = await fetch(`${WEB_ORIGIN}/api/trips`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: WEB_ORIGIN,
        "Idempotency-Key": randomUUID(),
        Cookie: cookieHeader(hinataCookies),
      },
      body: JSON.stringify({
        name: "手動確認の旅行",
        startsOn: daysFromToday(30),
        endsOn: daysFromToday(31),
      }),
    });
    if (!createResponse.ok) {
      throw new Error(
        `旅行の作成に失敗しました: ${createResponse.status} ${await createResponse.text()}`,
      );
    }
    const created = await createResponse.json();
    const tripId = created.id ?? created.trip?.id;
    if (typeof tripId !== "string") {
      throw new Error(
        `旅行の作成応答からtrip idを取れませんでした: ${JSON.stringify(created)}`,
      );
    }

    // 6. 別々のプロファイルの実Chromeを2つ開く。
    // 既定はchannel:"chrome"（実機のGoogle Chrome）。Chromeの無い環境で
    // 起動の確認だけをしたいときは、実ファイルを
    // TOMOTABI_MANUAL_CHROME_EXECUTABLE に渡すとそちらを使う。
    const { chromium } = await import("@playwright/test");
    const chromeExecutable = process.env.TOMOTABI_MANUAL_CHROME_EXECUTABLE;
    const openChrome = async (label, cookies) => {
      const dir = mkdtempSync(join(tmpdir(), `tomotabi-manual-${label}-`));
      profiles.push(dir);
      const context = await chromium.launchPersistentContext(dir, {
        ...(chromeExecutable === undefined
          ? { channel: "chrome" }
          : { executablePath: chromeExecutable }),
        headless: false,
        viewport: { width: 430, height: 920 },
      });
      contexts.push(context);
      await context.addCookies(cookies);
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(`${WEB_ORIGIN}/trips/${tripId}/home`);
      return context;
    };
    await openChrome("hinata", hinataCookies);
    await openChrome("aoi", aoiCookies);

    console.log("");
    console.log("準備できました。");
    console.log(`- web: ${WEB_ORIGIN}  API: ${API_ORIGIN}`);
    console.log(`- 旅行: ${WEB_ORIGIN}/trips/${tripId}/home`);
    console.log(
      "- ひなた側の画面で「この端末の通知」を有効にし、あおい側で予定・支払い・精算を記録すると通知が届きます。",
    );
    console.log("- 止めるときは Ctrl-C（Chrome・API・web・DBをすべて止めます）。");

    // 両方のChromeが閉じられるまで、またはCtrl-Cまで待つ。
    const allClosed = Promise.all(
      contexts.map(
        (context) => new Promise((resolve) => context.on("close", resolve)),
      ),
    );
    const interrupted = new Promise((resolve) => {
      process.on("SIGINT", resolve);
      process.on("SIGTERM", resolve);
    });
    await Promise.race([allClosed, interrupted]);
  } finally {
    await cleanup();
  }
}

await main();
