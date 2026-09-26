import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { enrollGoogleAccount } from "../../src/cli/enroll/enroll-google-account";
import { EnrollmentError } from "../../src/cli/enroll/enrollment-error";
import { describeFailure } from "../../src/cli/shared/run-cli";
import type { Slot } from "../../src/cli/shared/slot";
import {
  FAKE_CLIENT_ID,
  FAKE_CODE,
  FAKE_ID_TOKEN_PREFIX,
  FakeGoogle,
  type PayloadOverride,
  RecordingIo,
} from "../cli/support/fake-google";
import { createRoles, migrateAsMigrator, startPostgres, type TestDatabase } from "../support/database";

const ALICE = { sub: "100000000000000000001", email: "alice@example.test", name: "Alice" };
const BOB = { sub: "100000000000000000002", email: "bob@example.test", name: "Bob" };

type Counts = {
  users: number;
  accounts: number;
  allowlist: number;
  sessions: number;
};

describe("admin CLI: enroll", () => {
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

  type RunOptions = {
    answer?: string;
    override?: PayloadOverride;
    tamperState?: (state: string) => string;
  };

  async function runEnroll(
    slot: Slot,
    account: typeof ALICE,
    options: RunOptions = {},
  ): Promise<{ google: FakeGoogle; io: RecordingIo; result: Promise<{ userId: string; slot: Slot }> }> {
    const google = new FakeGoogle(account, options.override);
    const io = new RecordingIo(options.answer ?? "yes");
    io.onAuthorizationUrl = (url) => google.openBrowser(url, options.tamperState);
    const result = enrollGoogleAccount({ clientId: FAKE_CLIENT_ID, google, io, pool: migrator }, slot);
    return { google, io, result };
  }

  function expectNoSecrets(io: RecordingIo, account: typeof ALICE): void {
    expect(io.output).not.toContain(FAKE_CODE);
    expect(io.output).not.toContain(FAKE_ID_TOKEN_PREFIX);
    expect(io.output).not.toContain(account.sub);
    expect(io.output).toContain(`****${account.sub.slice(-4)}`);
  }

  it("C-01 enrolls the first account into slot 0 in one transaction with null token columns", async () => {
    const { google, io, result } = await runEnroll(0, ALICE);
    const { userId } = await result;

    expect(google.exchanges).toHaveLength(1);
    expect(google.exchanges[0]!.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(google.exchanges[0]!.codeVerifier.length).toBeGreaterThanOrEqual(43);

    const user = await db.admin.query("SELECT name, email, email_verified FROM identity.users WHERE id = $1", [userId]);
    expect(user.rows[0]).toEqual({ name: "Alice", email: ALICE.email, email_verified: true });
    const account = await db.admin.query(
      "SELECT provider_id, account_id, access_token, refresh_token, id_token FROM identity.accounts WHERE user_id = $1",
      [userId],
    );
    expect(account.rows[0]).toEqual({
      provider_id: "google",
      account_id: ALICE.sub,
      access_token: null,
      refresh_token: null,
      id_token: null,
    });
    const allow = await db.admin.query(
      "SELECT slot, google_sub, enabled FROM identity.allowed_google_accounts WHERE user_id = $1",
      [userId],
    );
    expect(allow.rows[0]).toEqual({ slot: 0, google_sub: ALICE.sub, enabled: true });
    expect(io.prompts).toEqual(["slot 0 に登録しますか？"]);
    expectNoSecrets(io, ALICE);
  });

  it("C-02 enrolls a second account into slot 1 alongside slot 0", async () => {
    await (await runEnroll(0, ALICE)).result;
    const { result } = await runEnroll(1, BOB);
    await result;

    const rows = await db.admin.query<{ slot: number; google_sub: string }>(
      "SELECT slot, google_sub FROM identity.allowed_google_accounts ORDER BY slot",
    );
    expect(rows.rows).toEqual([
      { slot: 0, google_sub: ALICE.sub },
      { slot: 1, google_sub: BOB.sub },
    ]);
    expect(await counts()).toEqual({ users: 2, accounts: 2, allowlist: 2, sessions: 0 });
  });

  it("C-03 rejects an occupied slot as a constraint violation and rolls back users/accounts", async () => {
    await (await runEnroll(0, ALICE)).result;
    const { io, result } = await runEnroll(0, BOB);

    await expect(result).rejects.toMatchObject({ code: "23505" });
    const message = describeFailure(await result.catch((e: unknown) => e));
    expect(message).toContain("既に登録されています");
    expect(message).not.toContain(BOB.sub);
    expect(await counts()).toEqual({ users: 1, accounts: 1, allowlist: 1, sessions: 0 });
    expectNoSecrets(io, BOB);
  });

  it("C-04 rejects the same Google sub in another slot and rolls back", async () => {
    await (await runEnroll(0, ALICE)).result;
    const { result } = await runEnroll(1, { ...ALICE, email: "alice-2@example.test" });

    await expect(result).rejects.toMatchObject({ code: "23505" });
    expect(await counts()).toEqual({ users: 1, accounts: 1, allowlist: 1, sessions: 0 });
  });

  it("C-05 rejects a state mismatch before exchanging the code and registers nothing", async () => {
    const { google, io, result } = await runEnroll(0, ALICE, { tamperState: (s) => `${s}x` });

    await expect(result).rejects.toBeInstanceOf(EnrollmentError);
    await result.catch((e: EnrollmentError) => expect(e.code).toBe("STATE_MISMATCH"));
    expect(google.exchanges).toHaveLength(0);
    expect(io.prompts).toHaveLength(0);
    expect(io.output).not.toContain(FAKE_CODE);
    expect(await counts()).toEqual({ users: 0, accounts: 0, allowlist: 0, sessions: 0 });
  });

  describe("C-06 rejects ID token verification failures and registers nothing", () => {
    it.each<[string, PayloadOverride, string]>([
      ["aud", { aud: "other-client.apps.googleusercontent.com" }, "audience"],
      ["iss", { iss: "https://evil.example" }, "issuer"],
      ["exp", { exp: Math.floor(Date.now() / 1000) - 60 }, "too late"],
    ])("%s", async (_label, override, expectedMessage) => {
      const { io, result } = await runEnroll(0, ALICE, { override });
      await expect(result).rejects.toThrow(expectedMessage);
      expect(io.prompts).toHaveLength(0);
      expect(await counts()).toEqual({ users: 0, accounts: 0, allowlist: 0, sessions: 0 });
    });

    it.each<[string, PayloadOverride]>([
      ["nonce mismatch", { nonce: "someone-elses-nonce" }],
      ["nonce missing", { nonce: null }],
    ])("%s", async (_label, override) => {
      const { io, result } = await runEnroll(0, ALICE, { override });
      await expect(result).rejects.toBeInstanceOf(EnrollmentError);
      await result.catch((e: EnrollmentError) => expect(e.code).toBe("NONCE_MISMATCH"));
      expect(io.prompts).toHaveLength(0);
      expect(io.output).not.toContain(ALICE.sub);
      expect(await counts()).toEqual({ users: 0, accounts: 0, allowlist: 0, sessions: 0 });
    });
  });

  it("C-07 registers nothing when the answer is not `yes` and prints no secrets", async () => {
    for (const answer of ["no", "y", "YES", ""]) {
      const { io, result } = await runEnroll(0, ALICE, { answer });
      await expect(result).rejects.toBeInstanceOf(EnrollmentError);
      await result.catch((e: EnrollmentError) => expect(e.code).toBe("CANCELLED"));
      expect(io.prompts).toHaveLength(1);
      expect(io.output).toContain("表示名: Alice");
      expect(io.output).toContain(`メール: ${ALICE.email}`);
      expectNoSecrets(io, ALICE);
      expect(await counts()).toEqual({ users: 0, accounts: 0, allowlist: 0, sessions: 0 });
    }
  });
});
