import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRoles,
  migrateAsMigrator,
  startPostgres,
  type TestDatabase,
} from "../support/database";

const IDENTITY_TABLES = [
  "users",
  "accounts",
  "sessions",
  "verifications",
  "allowed_google_accounts",
] as const;

const TABLE_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"] as const;

// Exactly what app_runtime may do on each identity table (design "DB 設計").
const EXPECTED_RUNTIME_PRIVILEGES: Record<(typeof IDENTITY_TABLES)[number], string[]> = {
  users: ["SELECT"],
  accounts: ["SELECT"],
  sessions: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  verifications: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  allowed_google_accounts: ["SELECT"],
};

async function expectPermissionDenied(pool: Pool, sql: string, params: unknown[] = []): Promise<void> {
  await expect(pool.query(sql, params)).rejects.toMatchObject({ code: "42501" });
}

async function insertUser(pool: Pool, name: string, emailVerified = false): Promise<string> {
  const result = await pool.query<{ id: string }>(
    "INSERT INTO identity.users (name, email, email_verified) VALUES ($1, $2, $3) RETURNING id",
    [name, `${name}@example.test`, emailVerified],
  );
  return result.rows[0]!.id;
}

describe("identity schema migrations and runtime privileges", () => {
  let db: TestDatabase;
  let runtime: Pool;

  beforeAll(async () => {
    db = await startPostgres();
    await createRoles(db);
    await migrateAsMigrator(db);
    runtime = db.poolFor("app_runtime");
  }, 120_000);

  afterAll(async () => {
    await db?.stop();
  });

  it("D-01 creates the identity tables from an empty database", async () => {
    const result = await db.admin.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'identity' ORDER BY table_name",
    );
    expect(result.rows.map((row) => row.table_name)).toEqual([...IDENTITY_TABLES].sort());
  });

  it("D-02 does nothing when migrations are applied again", async () => {
    const snapshot = async () =>
      (
        await db.admin.query(
          `SELECT
             (SELECT count(*) FROM drizzle.__drizzle_migrations) AS migrations,
             (SELECT string_agg(table_name || '.' || column_name || ':' || data_type, ',' ORDER BY table_name, column_name)
                FROM information_schema.columns WHERE table_schema = 'identity') AS columns`,
        )
      ).rows[0];
    const before = await snapshot();
    await migrateAsMigrator(db);
    expect(await snapshot()).toEqual(before);
  });

  it("D-03 declares the required constraints", async () => {
    const result = await db.admin.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint c
         JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'identity'`,
    );
    const names = result.rows.map((row) => row.conname);
    expect(names).toEqual(
      expect.arrayContaining([
        "accounts_provider_account_unique",
        "allowed_google_accounts_pkey",
        "allowed_google_accounts_slot_check",
        "allowed_google_accounts_google_sub_length_check",
        "allowed_google_accounts_user_id_unique",
        "allowed_google_accounts_google_sub_unique",
        "allowed_google_accounts_user_id_users_id_fk",
      ]),
    );
  });

  describe("allowlist constraints", () => {
    let first: string;
    let second: string;
    let third: string;

    beforeAll(async () => {
      first = await insertUser(db.admin, "allow-first");
      second = await insertUser(db.admin, "allow-second");
      third = await insertUser(db.admin, "allow-third");
      await db.admin.query(
        "INSERT INTO identity.allowed_google_accounts (slot, user_id, google_sub) VALUES (0, $1, 'sub-first'), (1, $2, 'sub-second')",
        [first, second],
      );
    });

    it("D-04 rejects a third slot", async () => {
      await expect(
        db.admin.query(
          "INSERT INTO identity.allowed_google_accounts (slot, user_id, google_sub) VALUES (2, $1, 'sub-third')",
          [third],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("D-05 rejects a duplicate sub or user", async () => {
      await db.admin.query("DELETE FROM identity.allowed_google_accounts WHERE slot = 1");
      await expect(
        db.admin.query(
          "INSERT INTO identity.allowed_google_accounts (slot, user_id, google_sub) VALUES (1, $1, 'sub-first')",
          [third],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        db.admin.query(
          "INSERT INTO identity.allowed_google_accounts (slot, user_id, google_sub) VALUES (1, $1, 'sub-other')",
          [first],
        ),
      ).rejects.toMatchObject({ code: "23505" });
    });

    it.each([
      ["empty", ""],
      ["256 characters", "s".repeat(256)],
    ])("D-06 rejects a google_sub that is %s", async (_label, sub) => {
      await expect(
        db.admin.query(
          "INSERT INTO identity.allowed_google_accounts (slot, user_id, google_sub) VALUES (1, $1, $2)",
          [third, sub],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  describe("app_runtime role", () => {
    let userId: string;

    beforeAll(async () => {
      userId = await insertUser(db.admin, "runtime-user");
      await db.admin.query(
        "INSERT INTO identity.accounts (account_id, provider_id, user_id) VALUES ('runtime-sub', 'google', $1)",
        [userId],
      );
    });

    it("D-07 can run the DML needed for sign-in, session checks and sign-out", async () => {
      const session = await runtime.query<{ id: string }>(
        "INSERT INTO identity.sessions (token, expires_at, user_id) VALUES ('runtime-token', now() + interval '7 days', $1) RETURNING id",
        [userId],
      );
      await runtime.query("UPDATE identity.sessions SET user_agent = 'test' WHERE id = $1", [session.rows[0]!.id]);
      await runtime.query("DELETE FROM identity.sessions WHERE id = $1", [session.rows[0]!.id]);

      await runtime.query(
        "INSERT INTO identity.verifications (identifier, value, expires_at) VALUES ('state', 'value', now() + interval '10 minutes')",
      );
      await runtime.query("UPDATE identity.verifications SET value = 'next' WHERE identifier = 'state'");
      await runtime.query("DELETE FROM identity.verifications WHERE identifier = 'state'");

      await runtime.query("UPDATE identity.users SET email_verified = true, updated_at = now() WHERE id = $1", [userId]);

      for (const table of IDENTITY_TABLES) {
        await runtime.query(`SELECT count(*) FROM identity.${table}`);
      }
    });

    it("D-07b cannot write accounts", async () => {
      await expectPermissionDenied(
        runtime,
        "INSERT INTO identity.accounts (account_id, provider_id, user_id) VALUES ('other', 'google', $1)",
        [userId],
      );
      await expectPermissionDenied(runtime, "UPDATE identity.accounts SET access_token = 'x'");
      await expectPermissionDenied(runtime, "DELETE FROM identity.accounts");
    });

    it("D-08 cannot change the allowlist", async () => {
      await expectPermissionDenied(
        runtime,
        "INSERT INTO identity.allowed_google_accounts (slot, user_id, google_sub) VALUES (0, $1, 'runtime-sub')",
        [userId],
      );
      await expectPermissionDenied(runtime, "UPDATE identity.allowed_google_accounts SET enabled = false");
      await expectPermissionDenied(runtime, "DELETE FROM identity.allowed_google_accounts");
    });

    it.each([
      ["CREATE TABLE in identity", "CREATE TABLE identity.intruder (id int)"],
      ["CREATE TABLE in public", "CREATE TABLE public.intruder (id int)"],
      ["DROP TABLE", "DROP TABLE identity.sessions"],
      ["TRUNCATE", "TRUNCATE identity.sessions"],
      ["ALTER TABLE", "ALTER TABLE identity.users ADD COLUMN intruder int"],
    ])("D-09 cannot run DDL: %s", async (_label, sql) => {
      await expect(runtime.query(sql)).rejects.toMatchObject({
        code: expect.stringMatching(/^(42501|42P01)$/),
      });
    });

    it("D-10 can update only email_verified and updated_at on users", async () => {
      await expectPermissionDenied(
        runtime,
        "INSERT INTO identity.users (name, email) VALUES ('intruder', 'intruder@example.test')",
      );
      await expectPermissionDenied(runtime, "DELETE FROM identity.users WHERE id = $1", [userId]);
      await expectPermissionDenied(runtime, "UPDATE identity.users SET name = 'renamed' WHERE id = $1", [userId]);
      await expectPermissionDenied(runtime, "UPDATE identity.users SET email = 'x@example.test' WHERE id = $1", [userId]);
    });

    it("D-11 uses a 5 second statement timeout", async () => {
      const result = await runtime.query<{ statement_timeout: string }>("SHOW statement_timeout");
      expect(result.rows[0]!.statement_timeout).toBe("5s");
    });

    it("D-12 has exactly the granted table privileges and nothing more", async () => {
      for (const table of IDENTITY_TABLES) {
        const granted: string[] = [];
        for (const privilege of TABLE_PRIVILEGES) {
          const result = await db.admin.query<{ allowed: boolean }>(
            "SELECT has_table_privilege('app_runtime', $1, $2) AS allowed",
            [`identity.${table}`, privilege],
          );
          if (result.rows[0]!.allowed) {
            granted.push(privilege);
          }
        }
        expect({ table, granted }).toEqual({ table, granted: EXPECTED_RUNTIME_PRIVILEGES[table] });
      }

      const columns = await db.admin.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'identity' AND table_name = 'users'
            AND has_column_privilege('app_runtime', 'identity.users', column_name, 'UPDATE')
          ORDER BY column_name`,
      );
      expect(columns.rows.map((row) => row.column_name)).toEqual(["email_verified", "updated_at"]);
    });
  });
});
