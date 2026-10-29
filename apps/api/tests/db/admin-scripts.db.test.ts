import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client, Pool, type QueryResult } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GRANT_DATABASE_SQL,
  createRoles,
  migrateAsMigrator,
  startPostgres,
  type TestDatabase,
} from "../support/database";

// Administrator scripts for running production (design production-launch, docs/tests/production-launch.md AS-01〜08).
const ADMIN_DIR = join(__dirname, "../../db/admin");
const script = (name: string): string => readFileSync(join(ADMIN_DIR, name), "utf8");
const STOP_SQL = script("stop-runtime.sql");
const RESUME_SQL = script("resume-runtime.sql");
const NEUTRALIZE_SQL = script("neutralize-restored.sql");
const VERIFY_SQL = script("verify-restore.sql");

const MIGRATOR_PASSWORD = "test-migrator";
const RESTORED_DB = "tomotabi_restored";
const DUMP_PATH = "/tmp/tomotabi-test.dump";
const P256DH = `\\x04${"11".repeat(64)}`;
const AUTH_SECRET = `\\x${"22".repeat(16)}`;
const FINGERPRINT = "a".repeat(64);

let db: TestDatabase;
let migrator: Pool;
let restoredAdmin: Pool;
let restoredMigrator: Pool;

// A multi-statement script returns one result per statement; the checks read the last one.
function lastResult(result: QueryResult | QueryResult[]): QueryResult {
  return Array.isArray(result) ? result[result.length - 1]! : result;
}

async function verify(pool: Pool): Promise<Record<string, string>> {
  const rows = lastResult(await pool.query(VERIFY_SQL)).rows as { check_name: string; value: string }[];
  return Object.fromEntries(rows.map((row) => [row.check_name, row.value]));
}

function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

async function runtimeClient(): Promise<Client> {
  const client = new Client({ connectionString: db.urlFor("app_runtime") });
  // A terminated connection reports through the error event; the assertions look at query results.
  client.on("error", () => {});
  await client.connect();
  return client;
}

async function exec(command: string[]): Promise<void> {
  const result = await db.container.exec(command, { env: { PGPASSWORD: MIGRATOR_PASSWORD } });
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed: ${result.output}`);
  }
}

// Two people, one trip, two payments: the first settled (with its claim), the second open.
// Plus a login session and an enabled push subscription, which only neutralize-restored.sql touches.
async function seed(pool: Pool): Promise<void> {
  const users = await pool.query<{ id: string }>(
    "INSERT INTO identity.users (name, email) VALUES ('hinata', 'hinata@example.test'), ('aoi', 'aoi@example.test') RETURNING id",
  );
  const [slot0, slot1] = users.rows.map((row) => row.id);
  await pool.query(
    "INSERT INTO identity.allowed_google_accounts (slot, user_id, google_sub) VALUES (0, $1, 'sub-0'), (1, $2, 'sub-1')",
    [slot0, slot1],
  );
  await pool.query(
    "INSERT INTO identity.sessions (expires_at, token, user_id) VALUES (now() + interval '1 day', 'token-0', $1), (now() + interval '1 day', 'token-1', $2)",
    [slot0, slot1],
  );
  await pool.query(
    `INSERT INTO notification.push_subscriptions
       (id, user_id, endpoint, endpoint_hash, p256dh, auth_secret, registration_session_id, device_label, vapid_key_id)
     VALUES (gen_random_uuid(), $1, 'https://push.example.test/sub/1', $2::bytea, $3::bytea, $4::bytea,
             'session-1', 'iPhone', '2026-10')`,
    [slot0, `\\x${"ab".repeat(32)}`, P256DH, AUTH_SECRET],
  );
  const trip = await pool.query<{ id: string }>(
    "INSERT INTO planning.trips (name, starts_on, ends_on, created_by) VALUES ('京都 2 泊', '2026-09-01', '2026-09-03', $1) RETURNING id",
    [slot0],
  );
  const tripId = trip.rows[0]!.id;
  await pool.query(
    "INSERT INTO planning.trip_participants (trip_id, slot, user_id) VALUES ($1, 0, $2), ($1, 1, $3)",
    [tripId, slot0, slot1],
  );
  await pool.query("INSERT INTO infra.trip_finance_guards (trip_id) VALUES ($1)", [tripId]);
  const payments: string[] = [];
  for (let i = 0; i < 2; i += 1) {
    const payment = await pool.query<{ id: string }>(
      `INSERT INTO record.payments
         (trip_id, amount_yen, payer_slot, slot0_percent, slot0_burden_yen, slot1_burden_yen, contribution_yen, created_by)
       VALUES ($1, 7001, 0, 50, 3501, 3500, 3500, $2) RETURNING id`,
      [tripId, slot0],
    );
    payments.push(payment.rows[0]!.id);
  }
  const preview = await pool.query<{ id: string }>(
    "INSERT INTO settlement.previews (trip_id, created_by, signed_total_yen) VALUES ($1, $2, 3500) RETURNING id",
    [tripId, slot0],
  );
  const previewId = preview.rows[0]!.id;
  await pool.query(
    `INSERT INTO settlement.preview_items
       (preview_id, trip_id, payment_id, kind, contribution_yen, expected_claim_fingerprint, expected_cancelled)
     VALUES ($1, $2, $3, 'BASE', 3500, $4, false)`,
    [previewId, tripId, payments[0], FINGERPRINT],
  );
  const settlement = await pool.query<{ id: string }>(
    `INSERT INTO settlement.settlements (trip_id, preview_id, sequence, signed_total_yen, completion_kind, created_by)
     VALUES ($1, $2, 1, 3500, 'transfer_completed', $3) RETURNING id`,
    [tripId, previewId, slot0],
  );
  const settlementId = settlement.rows[0]!.id;
  await pool.query(
    `INSERT INTO settlement.items (settlement_id, trip_id, preview_id, payment_id, kind, contribution_yen)
     VALUES ($1, $2, $3, $4, 'BASE', 3500)`,
    [settlementId, tripId, previewId, payments[0]],
  );
  await pool.query(
    "INSERT INTO settlement.active_claims (trip_id, payment_id, kind, settlement_id) VALUES ($1, $2, 'BASE', $3)",
    [tripId, payments[0], settlementId],
  );
}

beforeAll(async () => {
  db = await startPostgres();
  await createRoles(db);
  await migrateAsMigrator(db);
  migrator = db.poolFor("migrator");
  // The test seeds as the superuser so it can write rows the runtime role may only append.
  await seed(db.admin);

  // Dump with the container's PostgreSQL 16 tools, as the runbook does, into a separate database.
  await exec(["pg_dump", "-h", "127.0.0.1", "-U", "migrator", "-d", "test", "-Fc", "-f", DUMP_PATH]);
  await db.admin.query(`CREATE DATABASE ${RESTORED_DB}`);
  const adminUrl = db.container.getConnectionUri();
  restoredAdmin = new Pool({ connectionString: databaseUrl(adminUrl, RESTORED_DB) });
  await restoredAdmin.query(GRANT_DATABASE_SQL);
  await exec([
    "pg_restore",
    "-h",
    "127.0.0.1",
    "-U",
    "migrator",
    "-d",
    RESTORED_DB,
    "--no-owner",
    "--exit-on-error",
    DUMP_PATH,
  ]);
  restoredMigrator = new Pool({ connectionString: databaseUrl(db.urlFor("migrator"), RESTORED_DB) });
}, 180_000);

afterAll(async () => {
  await Promise.all([restoredAdmin?.end(), restoredMigrator?.end()]);
  await db?.stop();
});

describe("stop-runtime.sql / resume-runtime.sql", () => {
  it("AS-01: 止めると、つないでいた接続は切られ、新しい接続はログインで断られる", async () => {
    const connected = await runtimeClient();
    await expect(connected.query("SELECT 1")).resolves.toBeDefined();

    const stopped = lastResult(await db.admin.query(STOP_SQL));
    expect(stopped.rows[0]).toMatchObject({ app_runtime_can_login: false });
    expect(Number(stopped.rows[0].remaining_app_runtime_connections)).toBe(0);

    await expect(connected.query("SELECT 1")).rejects.toThrow();
    await expect(runtimeClient()).rejects.toMatchObject({ code: "28000" });
  });

  it("AS-03: 止めた状態でもう一度流しても、失敗せず同じ状態のまま", async () => {
    const again = lastResult(await db.admin.query(STOP_SQL));
    expect(again.rows[0]).toMatchObject({ app_runtime_can_login: false });
  });

  it("AS-02: 再開すると、app_runtimeでまたつなげる", async () => {
    const resumed = lastResult(await db.admin.query(RESUME_SQL));
    expect(resumed.rows[0]).toMatchObject({ app_runtime_can_login: true });
    const client = await runtimeClient();
    await expect(client.query("SELECT 1")).resolves.toBeDefined();
    await client.end();
  });
});

describe("neutralize-restored.sql", () => {
  it("AS-04: 設定が無いか、つないだDBの名前と違えば止まり、何も変えない", async () => {
    await expect(restoredMigrator.query(NEUTRALIZE_SQL)).rejects.toThrow(/restored copy/);
    // 本番（元のDB）につないだまま、復元したDBの名前を添えて流しても止まる。
    const original = await migrator.connect();
    try {
      await original.query(`SET tomotabi.restored_copy = '${RESTORED_DB}'`);
      await expect(original.query(NEUTRALIZE_SQL)).rejects.toThrow(/restored copy/);
      await original.query("ROLLBACK");
    } finally {
      original.release();
    }
    const client = await restoredMigrator.connect();
    try {
      await client.query("SET tomotabi.restored_copy = 'yes'");
      await expect(client.query(NEUTRALIZE_SQL)).rejects.toThrow(/restored copy/);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    for (const pool of [migrator, restoredMigrator]) {
      const { rows } = await pool.query<{ count: string }>("SELECT count(*) FROM identity.sessions");
      expect(Number(rows[0]!.count)).toBe(2);
    }
  });

  it("AS-05・06: 後始末でセッションと購読を止め、照合の数字は元のDBと一致する", async () => {
    const before = await verify(migrator);
    const client = await restoredMigrator.connect();
    try {
      await client.query(`SET tomotabi.restored_copy = '${RESTORED_DB}'`);
      const result = lastResult(await client.query(NEUTRALIZE_SQL));
      expect(result.rows[0]).toEqual({ sessions: "0", verifications: "0", enabled_push_subscriptions: "0" });
    } finally {
      client.release();
    }

    const restored = await verify(restoredMigrator);
    expect(restored).toEqual(before);
    expect(restored["record.payments.count"]).toBe("2");
    expect(restored["record.payments.sum_yen"]).toBe("14002/7002/7000/7000");
    expect(restored["settlement.active_claims.count"]).toBe("1");
    expect(restored["settlement.active_claims.mismatch_with_history"]).toBe("0");
    expect(restored["migrations.count"]).not.toBe("0");
  });
});

describe("verify-restore.sql", () => {
  it("AS-07: 戻したDBに支払いが足されると、件数と金額の行が元と違う", async () => {
    const before = await verify(migrator);
    const client = await restoredAdmin.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO record.payments
           (trip_id, amount_yen, payer_slot, slot0_percent, slot0_burden_yen, slot1_burden_yen, contribution_yen, created_by)
         SELECT trip_id, 100, 0, 50, 50, 50, 50, created_by FROM record.payments LIMIT 1`,
      );
      const changed = Object.fromEntries(
        (lastResult(await client.query(VERIFY_SQL)).rows as { check_name: string; value: string }[]).map((row) => [
          row.check_name,
          row.value,
        ]),
      );
      expect(changed["record.payments.count"]).not.toBe(before["record.payments.count"]);
      expect(changed["record.payments.sum_yen"]).not.toBe(before["record.payments.sum_yen"]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("AS-08: 占有の行が欠けると、履歴との食い違いが0でなくなる", async () => {
    const client = await restoredAdmin.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM settlement.active_claims");
      const rows = lastResult(await client.query(VERIFY_SQL)).rows as { check_name: string; value: string }[];
      const mismatch = rows.find((row) => row.check_name === "settlement.active_claims.mismatch_with_history");
      expect(mismatch?.value).toBe("1");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
