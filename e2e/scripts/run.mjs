// E2Eの起動スクリプト（ADR-0005 Decision 4、設計書「データフロー」）。
// 1. TestcontainersのPostgreSQLを起動し、apps/api/tests/support/database.ts
//    と同じ手順でロールを作ってmigrationを当てる
//    （database.tsはCJSの __dirnameに依存するため .mjsからimportできず、
//    同じ手順をここにJSで再掲する）
// 2. ひなた・あおいのusers / accounts / allowlistを1回だけ入れる
// 3. 接続先・固定ポート・実行ごとのBETTER_AUTH_SECRETを環境変数に入れて
//    playwright testを子プロセスで起動する
// 4. 終わったら（失敗・中断でもfinallyで）コンテナを止め、Playwrightの
//    終了コードを返す
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const E2E_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(E2E_DIR, "..");
const API_ROOT = join(REPO_ROOT, "apps/api");
const MIGRATIONS_FOLDER = join(API_ROOT, "drizzle");

// apps/api/tests/support/database.tsのROLE_PASSWORDSと同じ値。
const ROLE_PASSWORDS = {
  migrator: "test-migrator",
  app_runtime: "test-app-runtime",
};

// support/env.ts・playwright.config.tsと同じ固定値（webのbuildに
// API_ORIGINが焼き込まれるため、実行ごとに変えられない）。
const WEB_PORT = 3100;
const API_PORT = 3101;

// support/db.tsのTRUNCATEと同じ文。起動時に1度通して、追記のみ保証
// （migration 0003の行トリガー）との相性を起動のたびに確かめる。
const TRUNCATE_BUSINESS_TABLES = `TRUNCATE
  planning.plans, planning.trip_participants, planning.trips,
  record.active_plan_events, record.plan_event_cancellations, record.plan_events,
  infra.command_receipts, infra.trip_finance_guards
  RESTART IDENTITY CASCADE`;

const run = (command, args, options = {}) =>
  spawnSync(command, args, { stdio: "inherit", ...options });

async function main() {
  let container;
  try {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `Docker is required for Testcontainers. E2E verification is incomplete. (${message})`,
    );
    process.exitCode = 1;
    return;
  }

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

  try {
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

    if (process.env.E2E_SKIP_BUILD === "1") {
      // CI用（設計書「データフロー」）。apps/web/.nextはAPI_ORIGINを
      // build時に焼き込むため、手元の`npm run build`（API_ORIGINなし、
      // 3001向き）の成果物を拾うと /apiがAPIに届かずログインに失敗する。
      // 起動してから落ちると原因が分かりにくいので、転送先を先に確かめる。
      let destination;
      try {
        const manifest = JSON.parse(
          readFileSync(
            join(REPO_ROOT, "apps/web/.next/routes-manifest.json"),
            "utf8",
          ),
        );
        destination = (manifest.rewrites?.afterFiles ?? []).find(
          (entry) => entry.source === "/api/:path*",
        )?.destination;
      } catch {
        destination = undefined;
      }
      if (destination !== `http://localhost:${API_PORT}/api/:path*`) {
        console.error(
          "E2E_SKIP_BUILD=1 には、E2E 用の API_ORIGIN で build した" +
            ` apps/web/.next が必要です（現在の転送先: ${destination ?? "なし"}）。` +
            " 先に E2E_SKIP_BUILD なしで `npm run test:e2e` を 1 回実行してください。",
        );
        process.exitCode = 1;
        return;
      }
    } else {
      // contractsのdistはapi / web両方のbuildの前提。webServerが
      // 並行して走る前に、ここで1回だけビルドする。
      const contracts = run("npm", ["run", "build", "-w", "@tomotabi/contracts"], {
        cwd: REPO_ROOT,
      });
      if (contracts.status !== 0) {
        process.exitCode = contracts.status ?? 1;
        return;
      }
    }

    const child = spawn("npx", ["playwright", "test"], {
      cwd: E2E_DIR,
      stdio: "inherit",
      env: {
        ...process.env,
        E2E_DATABASE_URL_RUNTIME: urlFor("app_runtime"),
        E2E_DATABASE_URL_MIGRATOR: urlFor("migrator"),
        E2E_API_PORT: String(API_PORT),
        E2E_WEB_PORT: String(WEB_PORT),
        E2E_AUTH_SECRET: randomBytes(32).toString("hex"),
        E2E_HINATA_USER_ID: hinataUserId,
        E2E_AOI_USER_ID: aoiUserId,
      },
    });
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.on(signal, () => child.kill(signal));
    }
    const code = await new Promise((resolve) => {
      child.on("close", (exitCode) => resolve(exitCode));
    });
    process.exitCode = typeof code === "number" ? code : 1;
  } finally {
    await Promise.allSettled(pools.map((pool) => pool.end()));
    await container.stop();
  }
}

await main();
