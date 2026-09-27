import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRoles,
  GRANT_DATABASE_SQL,
  MIGRATIONS_FOLDER,
  migrateAsMigrator,
  startPostgres,
  type RoleName,
  type TestDatabase,
} from "../support/database";

const M2_TABLES = [
  "planning.plans",
  "planning.trip_participants",
  "planning.trips",
  "record.active_plan_events",
  "record.plan_event_cancellations",
  "record.plan_events",
  "infra.command_receipts",
  "infra.trip_finance_guards",
] as const;

const M2_INDEXES = [
  "plans_day_idx",
  "trip_participants_user_idx",
  "trips_list_idx",
  "plan_events_history_idx",
  "plan_events_timeline_idx",
  "plan_event_cancellations_timeline_idx",
] as const;

async function migrateFolder(connectionString: string, migrationsFolder: string): Promise<void> {
  const pool = new Pool({ connectionString });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

// A folder that replays only the first `count` journal entries, for upgrade-path tests.
function migrationsFolderWithFirst(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), "tomotabi-migrations-"));
  mkdirSync(join(dir, "meta"));
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8")) as {
    entries: { tag: string }[];
  };
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(join(dir, "meta/_journal.json"), JSON.stringify(journal));
  for (const entry of journal.entries) {
    copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
  }
  return dir;
}

function urlFor(role: RoleName, database: string): string {
  const url = new URL(db.urlFor(role));
  url.pathname = `/${database}`;
  return url.toString();
}

let db: TestDatabase;

async function insertUser(pool: Pool, name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    "INSERT INTO identity.users (name, email) VALUES ($1, $2) RETURNING id",
    [name, `${name}@example.test`],
  );
  return result.rows[0]!.id;
}

async function insertTrip(pool: Pool, createdBy: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    "INSERT INTO planning.trips (name, starts_on, ends_on, created_by) VALUES ('京都 2 泊', '2026-09-01', '2026-09-03', $1) RETURNING id",
    [createdBy],
  );
  return result.rows[0]!.id;
}

async function insertPlan(pool: Pool, tripId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    "INSERT INTO planning.plans (trip_id, name, kind, planned_date) VALUES ($1, '清水寺', 'place', '2026-09-02') RETURNING id",
    [tripId],
  );
  return result.rows[0]!.id;
}

// A trip whose two participants are the users allowed to act on it (slot 0 / 1).
async function seedTrip(
  pool: Pool,
): Promise<{ tripId: string; planId: string; slot0: string; slot1: string }> {
  const slot0 = await insertUser(pool, `hinata-${crypto.randomUUID().slice(0, 8)}`);
  const slot1 = await insertUser(pool, `aoi-${crypto.randomUUID().slice(0, 8)}`);
  const tripId = await insertTrip(pool, slot0);
  await pool.query(
    "INSERT INTO planning.trip_participants (trip_id, slot, user_id) VALUES ($1, 0, $2), ($1, 1, $3)",
    [tripId, slot0, slot1],
  );
  const planId = await insertPlan(pool, tripId);
  return { tripId, planId, slot0, slot1 };
}

describe("planning / record / infra schema migrations and runtime privileges", () => {
  let runtime: Pool;
  let migrator: Pool;

  beforeAll(async () => {
    db = await startPostgres();
    await createRoles(db);
    await migrateAsMigrator(db);
    runtime = db.poolFor("app_runtime");
    migrator = db.poolFor("migrator");
  }, 120_000);

  afterAll(async () => {
    await db?.stop();
  });

  it("D-01 creates the 8 tables, indexes, triggers and function from an empty database", async () => {
    const tables = await db.admin.query<{ name: string }>(
      `SELECT table_schema || '.' || table_name AS name FROM information_schema.tables
        WHERE table_schema IN ('planning', 'record', 'infra') AND table_type = 'BASE TABLE'
        ORDER BY name`,
    );
    expect(tables.rows.map((row) => row.name)).toEqual([...M2_TABLES].sort());

    const indexes = await db.admin.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname IN ('planning', 'record', 'infra')`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual(expect.arrayContaining([...M2_INDEXES]));

    const triggers = await db.admin.query<{ event_object_table: string }>(
      `SELECT DISTINCT event_object_table FROM information_schema.triggers
        WHERE trigger_name = 'reject_mutation' AND trigger_schema = 'record'
        ORDER BY event_object_table`,
    );
    expect(triggers.rows.map((row) => row.event_object_table)).toEqual([
      "plan_event_cancellations",
      "plan_events",
    ]);

    const routine = await db.admin.query(
      `SELECT routine_name FROM information_schema.routines
        WHERE routine_schema = 'infra' AND routine_name = 'reject_history_mutation'`,
    );
    expect(routine.rows).toHaveLength(1);
  });

  it("D-02 applies on top of an M1 database without touching existing rows", async () => {
    await db.admin.query("CREATE DATABASE m1_upgrade");
    const secondAdmin = new Pool({
      connectionString: db.container.getConnectionUri().replace(/\/[^/]*$/, "/m1_upgrade"),
    });
    try {
      await secondAdmin.query(GRANT_DATABASE_SQL);
      await migrateFolder(urlFor("migrator", "m1_upgrade"), migrationsFolderWithFirst(2));

      const userId = await insertUser(secondAdmin, "existing-user");
      await secondAdmin.query(
        "INSERT INTO identity.allowed_google_accounts (slot, user_id, google_sub) VALUES (0, $1, 'existing-sub')",
        [userId],
      );

      await migrateFolder(urlFor("migrator", "m1_upgrade"), MIGRATIONS_FOLDER);

      const users = await secondAdmin.query<{ name: string }>(
        "SELECT name FROM identity.users WHERE id = $1",
        [userId],
      );
      expect(users.rows[0]!.name).toBe("existing-user");
      const allowlist = await secondAdmin.query(
        "SELECT count(*) AS count FROM identity.allowed_google_accounts",
      );
      expect(allowlist.rows[0]!.count).toBe("1");

      const tables = await secondAdmin.query<{ count: string }>(
        `SELECT count(*) AS count FROM information_schema.tables
          WHERE table_schema IN ('planning', 'record', 'infra')`,
      );
      expect(tables.rows[0]!.count).toBe(String(M2_TABLES.length));
    } finally {
      await secondAdmin.end();
    }
  });

  it("D-03 does nothing when migrations are applied again", async () => {
    const snapshot = async () =>
      (
        await db.admin.query(
          `SELECT
             (SELECT count(*) FROM drizzle.__drizzle_migrations) AS migrations,
             (SELECT string_agg(table_schema || '.' || table_name || '.' || column_name || ':' || data_type, ',' ORDER BY table_schema, table_name, column_name)
                FROM information_schema.columns
                WHERE table_schema IN ('planning', 'record', 'infra')) AS columns,
             (SELECT count(*) FROM information_schema.triggers WHERE trigger_schema = 'record') AS triggers`,
        )
      ).rows[0];
    const before = await snapshot();
    await migrateAsMigrator(db);
    expect(await snapshot()).toEqual(before);
  });

  describe("trips constraints (D-04)", () => {
    let userId: string;

    beforeAll(async () => {
      userId = await insertUser(db.admin, "trips-owner");
    });

    it.each([
      ["a whitespace-only name", "INSERT INTO planning.trips (name, starts_on, ends_on, created_by) VALUES ('   ', '2026-09-01', '2026-09-03', $1)"],
      ["starts_on after ends_on", "INSERT INTO planning.trips (name, starts_on, ends_on, created_by) VALUES ('x', '2026-09-04', '2026-09-03', $1)"],
      ["traveling without started fields", "INSERT INTO planning.trips (name, starts_on, ends_on, status, created_by) VALUES ('x', '2026-09-01', '2026-09-03', 'traveling', $1)"],
    ])("rejects %s", async (_label, sql) => {
      await expect(db.admin.query(sql, [userId])).rejects.toMatchObject({ code: "23514" });
    });

    it("rejects finished_at before started_at", async () => {
      const { tripId, slot0 } = await seedTrip(db.admin);
      await expect(
        db.admin.query(
          `UPDATE planning.trips
             SET status = 'finished', started_at = '2026-09-02T10:00:00Z', started_by = $2,
                 finished_at = '2026-09-02T09:00:00Z', finished_by = $2
           WHERE id = $1`,
          [tripId, slot0],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  describe("trip_participants constraints (D-05)", () => {
    it("rejects a third slot and the same user twice", async () => {
      const { tripId, slot0 } = await seedTrip(db.admin);
      const third = await insertUser(db.admin, "sota");
      await expect(
        db.admin.query(
          "INSERT INTO planning.trip_participants (trip_id, slot, user_id) VALUES ($1, 2, $2)",
          [tripId, third],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        db.admin.query(
          "INSERT INTO planning.trip_participants (trip_id, slot, user_id) VALUES ($1, 1, $2)",
          [tripId, slot0],
        ),
      ).rejects.toMatchObject({ code: "23505" });
    });
  });

  describe("plans constraints (D-06)", () => {
    it("rejects a time with seconds", async () => {
      const { tripId } = await seedTrip(db.admin);
      await expect(
        db.admin.query(
          "INSERT INTO planning.plans (trip_id, name, kind, planned_date, planned_time) VALUES ($1, 'x', 'place', '2026-09-02', '09:00:30')",
          [tripId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("rejects cancelled_at without cancelled_by", async () => {
      const { tripId } = await seedTrip(db.admin);
      await expect(
        db.admin.query(
          "INSERT INTO planning.plans (trip_id, name, kind, planned_date, cancelled_at) VALUES ($1, 'x', 'place', '2026-09-02', now())",
          [tripId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("rejects cancelled_by that is not a participant", async () => {
      const { tripId } = await seedTrip(db.admin);
      const outsider = await insertUser(db.admin, "outsider");
      await expect(
        db.admin.query(
          "INSERT INTO planning.plans (trip_id, name, kind, planned_date, cancelled_at, cancelled_by) VALUES ($1, 'x', 'place', '2026-09-02', now(), $2)",
          [tripId, outsider],
        ),
      ).rejects.toMatchObject({ code: "23503" });
    });
  });

  describe("append-only history (D-07)", () => {
    it("rejects UPDATE and DELETE on plan_events and cancellations even as migrator", async () => {
      const { tripId, planId, slot0 } = await seedTrip(db.admin);
      const event = await db.admin.query<{ id: string }>(
        "INSERT INTO record.plan_events (trip_id, plan_id, event_kind, created_by) VALUES ($1, $2, 'achievement', $3) RETURNING id",
        [tripId, planId, slot0],
      );
      const eventId = event.rows[0]!.id;
      await db.admin.query(
        "INSERT INTO record.plan_event_cancellations (event_id, trip_id, cancelled_by) VALUES ($1, $2, $3)",
        [eventId, tripId, slot0],
      );

      await expect(
        migrator.query("UPDATE record.plan_events SET event_kind = 'booking' WHERE id = $1", [eventId]),
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        migrator.query("DELETE FROM record.plan_events WHERE id = $1", [eventId]),
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        migrator.query("UPDATE record.plan_event_cancellations SET cancelled_by = $1 WHERE event_id = $2", [
          slot0,
          eventId,
        ]),
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        migrator.query("DELETE FROM record.plan_event_cancellations WHERE event_id = $1", [eventId]),
      ).rejects.toMatchObject({ code: "55000" });
    });
  });

  describe("app_runtime role", () => {
    let tripId: string;
    let planId: string;
    let slot0: string;
    let slot1: string;

    beforeAll(async () => {
      // app_runtime itself creates the rows, so INSERT grants are exercised too.
      slot0 = await insertUser(db.admin, "runtime-hinata");
      slot1 = await insertUser(db.admin, "runtime-aoi");
      tripId = await insertTrip(runtime, slot0);
      await runtime.query(
        "INSERT INTO planning.trip_participants (trip_id, slot, user_id) VALUES ($1, 0, $2), ($1, 1, $3)",
        [tripId, slot0, slot1],
      );
      planId = await insertPlan(runtime, tripId);
    });

    it("D-08 can run every operation the design grants", async () => {
      for (const table of M2_TABLES) {
        await runtime.query(`SELECT count(*) FROM ${table}`);
      }

      await runtime.query(
        "INSERT INTO infra.trip_finance_guards (trip_id) VALUES ($1)",
        [tripId],
      );
      await runtime.query(
        `INSERT INTO infra.command_receipts
           (actor_id, operation, idempotency_key, trip_id, request_hash, resource_type, resource_id, http_status, response_body)
         VALUES ($1, 'createTrip', $2, $3, $4, 'trip', $3, 201, '{}'::jsonb)`,
        [slot0, crypto.randomUUID(), tripId, "a".repeat(64)],
      );

      await runtime.query("UPDATE planning.trips SET name = 'renamed', version = 2, updated_at = now() WHERE id = $1", [tripId]);
      await runtime.query("UPDATE planning.plans SET memo = 'memo', version = 2, updated_at = now() WHERE id = $1", [planId]);

      const client = await runtime.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM planning.trips WHERE id = $1 FOR UPDATE", [tripId]);
        await client.query("SELECT id FROM planning.trips WHERE id = $1 FOR SHARE", [tripId]);
        await client.query("SELECT id FROM planning.plans WHERE id = $1 FOR NO KEY UPDATE", [planId]);
        await client.query("SELECT id FROM planning.plans WHERE id = $1 FOR UPDATE", [planId]);
        await client.query("COMMIT");
      } finally {
        client.release();
      }
    });

    it("D-09 cannot run anything the design does not grant", async () => {
      for (const table of M2_TABLES) {
        await expectPermissionDenied(runtime, `DELETE FROM ${table}`);
      }
      await expectPermissionDenied(
        runtime,
        "UPDATE planning.trip_participants SET slot = 1 WHERE trip_id = $1 AND slot = 0",
        [tripId],
      );
      await expectPermissionDenied(
        runtime,
        "UPDATE infra.trip_finance_guards SET next_settlement_sequence = 2 WHERE trip_id = $1",
        [tripId],
      );
      await expectPermissionDenied(
        runtime,
        "UPDATE infra.command_receipts SET http_status = 200 WHERE trip_id = $1",
        [tripId],
      );
      for (const table of ["plan_events", "plan_event_cancellations", "active_plan_events"]) {
        await expectPermissionDenied(
          runtime,
          `INSERT INTO record.${table} (trip_id) VALUES ($1)`,
          [tripId],
        );
      }
      await expectPermissionDenied(
        runtime,
        "UPDATE planning.trips SET created_by = $1 WHERE id = $2",
        [slot1, tripId],
      );
      await expectPermissionDenied(
        runtime,
        "UPDATE planning.plans SET trip_id = $1 WHERE id = $2",
        [tripId, planId],
      );
    });

    it.each([
      ["CREATE TABLE", "CREATE TABLE planning.intruder (id int)"],
      ["DROP TABLE", "DROP TABLE planning.trips"],
      ["ALTER TABLE", "ALTER TABLE planning.trips ADD COLUMN intruder int"],
      ["TRUNCATE", "TRUNCATE planning.trips"],
    ])("D-09 cannot run DDL: %s", async (_label, sql) => {
      await expect(runtime.query(sql)).rejects.toMatchObject({
        code: expect.stringMatching(/^(42501|42P01)$/),
      });
    });

    it("D-10 cannot lock the allowlist (the reason trip creation does not lock it)", async () => {
      const userId = await insertUser(db.admin, "allowlisted");
      await db.admin.query(
        "INSERT INTO identity.allowed_google_accounts (slot, user_id, google_sub) VALUES (0, $1, 'sub-d10')",
        [userId],
      );
      await expectPermissionDenied(
        runtime,
        "SELECT slot FROM identity.allowed_google_accounts FOR SHARE",
      );
    });
  });
});

async function expectPermissionDenied(pool: Pool, sql: string, params: unknown[] = []): Promise<void> {
  await expect(pool.query(sql, params)).rejects.toMatchObject({ code: "42501" });
}
