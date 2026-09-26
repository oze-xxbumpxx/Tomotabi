import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { disableGoogleAccount, SlotNotEnrolledError } from "../../src/cli/disable/disable-google-account";
import { enrollGoogleAccount } from "../../src/cli/enroll/enroll-google-account";
import type { Slot } from "../../src/cli/shared/slot";
import { FAKE_CLIENT_ID, FakeGoogle, RecordingIo } from "../cli/support/fake-google";
import { createRoles, migrateAsMigrator, startPostgres, type TestDatabase } from "../support/database";

const ALICE = { sub: "100000000000000000001", email: "alice@example.test", name: "Alice" };
const BOB = { sub: "100000000000000000002", email: "bob@example.test", name: "Bob" };

type Counts = {
  users: number;
  accounts: number;
  allowlist: number;
  sessions: number;
};

describe("admin CLI: disable", () => {
  let db: TestDatabase;
  let migrator: Pool;

  beforeAll(async () => {
    db = await startPostgres();
    await createRoles(db);
    await migrateAsMigrator(db);
    migrator = db.poolFor("migrator");
  }, 120_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.admin.query(
      "TRUNCATE identity.sessions, identity.allowed_google_accounts, identity.accounts, identity.users CASCADE",
    );
  });

  async function counts(): Promise<Counts> {
    const q = async (table: string) =>
      Number((await db.admin.query<{ n: string }>(`SELECT count(*) AS n FROM identity.${table}`)).rows[0]!.n);
    return {
      users: await q("users"),
      accounts: await q("accounts"),
      allowlist: await q("allowed_google_accounts"),
      sessions: await q("sessions"),
    };
  }

  async function runEnroll(slot: Slot, account: typeof ALICE): Promise<{ userId: string }> {
    const google = new FakeGoogle(account);
    const io = new RecordingIo("yes");
    io.onAuthorizationUrl = (url) => google.openBrowser(url);
    return enrollGoogleAccount({ clientId: FAKE_CLIENT_ID, google, io, pool: migrator }, slot);
  }

  async function insertSession(userId: string, token: string): Promise<void> {
    await db.admin.query(
      "INSERT INTO identity.sessions (expires_at, token, user_id) VALUES (now() + interval '1 day', $1, $2)",
      [token, userId],
    );
  }

  it("C-08 disables slot 0 and deletes only that user's sessions in one transaction", async () => {
    const alice = await runEnroll(0, ALICE);
    const bob = await runEnroll(1, BOB);
    await insertSession(alice.userId, "alice-session-1");
    await insertSession(alice.userId, "alice-session-2");
    await insertSession(bob.userId, "bob-session-1");

    const result = await disableGoogleAccount(migrator, 0);
    expect(result).toEqual({ userId: alice.userId, deletedSessions: 2 });

    const allow = await db.admin.query<{ slot: number; enabled: boolean }>(
      "SELECT slot, enabled FROM identity.allowed_google_accounts ORDER BY slot",
    );
    expect(allow.rows).toEqual([
      { slot: 0, enabled: false },
      { slot: 1, enabled: true },
    ]);
    const sessions = await db.admin.query<{ token: string }>("SELECT token FROM identity.sessions");
    expect(sessions.rows).toEqual([{ token: "bob-session-1" }]);
    expect(await counts()).toEqual({ users: 2, accounts: 2, allowlist: 2, sessions: 1 });
  });

  it("C-09 re-running disable succeeds with the same final state", async () => {
    const alice = await runEnroll(0, ALICE);
    await insertSession(alice.userId, "alice-session-1");

    await disableGoogleAccount(migrator, 0);
    const again = await disableGoogleAccount(migrator, 0);
    expect(again).toEqual({ userId: alice.userId, deletedSessions: 0 });

    const allow = await db.admin.query<{ enabled: boolean }>(
      "SELECT enabled FROM identity.allowed_google_accounts WHERE slot = 0",
    );
    expect(allow.rows).toEqual([{ enabled: false }]);
    expect(await counts()).toEqual({ users: 1, accounts: 1, allowlist: 1, sessions: 0 });
  });

  it("disable fails without changes when the slot is not enrolled", async () => {
    await expect(disableGoogleAccount(migrator, 1)).rejects.toBeInstanceOf(SlotNotEnrolledError);
    expect(await counts()).toEqual({ users: 0, accounts: 0, allowlist: 0, sessions: 0 });
  });
});
