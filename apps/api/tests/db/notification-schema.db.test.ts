import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRoles,
  migrateAsMigrator,
  startPostgres,
  type TestDatabase,
} from "../support/database";

// PD-01: drizzle/0009_notification_tables.sql と 0010_notification_grants.sql
// （写し元: docs/旅行アプリ設計3/詳細設計/sql/05_push_notifications.sql）。
// app_runtimeはnotificationスキーマの2つの表にSELECT・INSERT・UPDATEでき、DELETEはできない。
const NOTIFICATION_TABLES = [
  "notification.closed_push_sessions",
  "notification.push_subscriptions",
] as const;

let db: TestDatabase;

async function insertUser(name: string): Promise<string> {
  const result = await db.admin.query<{ id: string }>(
    "INSERT INTO identity.users (name, email) VALUES ($1, $2) RETURNING id",
    [name, `${name}@example.test`],
  );
  return result.rows[0]!.id;
}

async function expectPermissionDenied(
  pool: Pool,
  sql: string,
  params: unknown[] = [],
): Promise<void> {
  await expect(pool.query(sql, params)).rejects.toMatchObject({
    code: "42501",
  });
}

async function expectCheckViolation(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code: "23514" });
}

// endpoint_hashは32バイト、p256dhは0x04で始まる65バイト、auth_secretは16バイトのbytea。
const ENDPOINT_HASH = "\\x" + "ab".repeat(32);
const P256DH = "\\x04" + "cd".repeat(64);
const AUTH_SECRET = "\\x" + "ef".repeat(16);

function insertSubscription(pool: Pool, userId: string, endpoint: string) {
  return pool.query<{ id: string }>(
    `INSERT INTO notification.push_subscriptions
       (id, user_id, endpoint, endpoint_hash, p256dh, auth_secret,
        registration_session_id, device_label, vapid_key_id)
     VALUES (gen_random_uuid(), $1, $2, $3::bytea, $4::bytea, $5::bytea,
             'session-1', 'iPhone', '2026-10')
     RETURNING id`,
    [userId, endpoint, ENDPOINT_HASH, P256DH, AUTH_SECRET],
  );
}

describe("notification schema (PD-01)", () => {
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

  it("creates the 2 notification tables and the 2 indexes", async () => {
    const tables = await db.admin.query<{ name: string }>(
      `SELECT table_schema || '.' || table_name AS name FROM information_schema.tables
        WHERE table_schema = 'notification' ORDER BY name`,
    );
    expect(tables.rows.map((row) => row.name)).toEqual([...NOTIFICATION_TABLES]);

    const indexes = await db.admin.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'notification'`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        "push_subscriptions_user",
        "push_subscriptions_session",
      ]),
    );
  });

  it("lets app_runtime SELECT, INSERT and UPDATE both tables but not DELETE", async () => {
    const userId = await insertUser(`push-${crypto.randomUUID().slice(0, 8)}`);

    const subscription = await insertSubscription(
      runtime,
      userId,
      "https://push.example.test/sub/1",
    );
    const subscriptionId = subscription.rows[0]!.id;

    const closed = await runtime.query(
      `INSERT INTO notification.closed_push_sessions (session_id, user_id)
       VALUES ('session-closed-1', $1) RETURNING session_id`,
      [userId],
    );
    expect(closed.rowCount).toBe(1);

    const listed = await runtime.query(
      "SELECT id, enabled, revision FROM notification.push_subscriptions WHERE id = $1",
      [subscriptionId],
    );
    expect(listed.rows).toEqual([
      { id: subscriptionId, enabled: true, revision: "1" },
    ]);
    const closedListed = await runtime.query(
      "SELECT session_id FROM notification.closed_push_sessions WHERE session_id = 'session-closed-1'",
    );
    expect(closedListed.rowCount).toBe(1);

    const updated = await runtime.query(
      `UPDATE notification.push_subscriptions
         SET enabled = false, revision = revision + 1, updated_at = now()
       WHERE id = $1 RETURNING revision`,
      [subscriptionId],
    );
    expect(updated.rows[0]!.revision).toBe("2");
    await runtime.query(
      `UPDATE notification.closed_push_sessions SET closed_at = now()
       WHERE session_id = 'session-closed-1'`,
    );

    await expectPermissionDenied(
      runtime,
      "DELETE FROM notification.push_subscriptions WHERE id = $1",
      [subscriptionId],
    );
    await expectPermissionDenied(
      runtime,
      "DELETE FROM notification.closed_push_sessions WHERE session_id = 'session-closed-1'",
    );
  });

  it("rejects malformed bytea columns and timestamps", async () => {
    const userId = await insertUser(`push-${crypto.randomUUID().slice(0, 8)}`);

    // endpoint_hashは32バイトちょうど。
    await expectCheckViolation(
      runtime.query(
        `INSERT INTO notification.push_subscriptions
           (id, user_id, endpoint, endpoint_hash, p256dh, auth_secret,
            registration_session_id, device_label, vapid_key_id)
         VALUES (gen_random_uuid(), $1, 'https://push.example.test/sub/2',
                 '\\xabab'::bytea, $2::bytea, $3::bytea,
                 'session-2', 'iPhone', '2026-10')`,
        [userId, P256DH, AUTH_SECRET],
      ),
    );
    // p256dhは65バイトの非圧縮点（先頭0x04）。
    await expectCheckViolation(
      runtime.query(
        `INSERT INTO notification.push_subscriptions
           (id, user_id, endpoint, endpoint_hash, p256dh, auth_secret,
            registration_session_id, device_label, vapid_key_id)
         VALUES (gen_random_uuid(), $1, 'https://push.example.test/sub/3',
                 $2::bytea, ('\\x05' || repeat('cd', 64))::bytea, $3::bytea,
                 'session-3', 'iPhone', '2026-10')`,
        [userId, ENDPOINT_HASH, AUTH_SECRET],
      ),
    );
    // updated_atはcreated_at以降。
    await expectCheckViolation(
      runtime.query(
        `INSERT INTO notification.push_subscriptions
           (id, user_id, endpoint, endpoint_hash, p256dh, auth_secret,
            registration_session_id, device_label, vapid_key_id,
            created_at, updated_at)
         VALUES (gen_random_uuid(), $1, 'https://push.example.test/sub/4',
                 $2::bytea, $3::bytea, $4::bytea,
                 'session-4', 'iPhone', '2026-10',
                 '2026-10-02 00:00:00+00', '2026-10-01 00:00:00+00')`,
        [userId, ENDPOINT_HASH, P256DH, AUTH_SECRET],
      ),
    );
    // closed_push_sessionsのsession_idは空でない。
    await expectCheckViolation(
      runtime.query(
        `INSERT INTO notification.closed_push_sessions (session_id, user_id)
         VALUES ('', $1)`,
        [userId],
      ),
    );
  });
});
