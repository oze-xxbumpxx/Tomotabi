import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestDatabase } from "../support/database";
import {
  createRoles,
  migrateAsMigrator,
  startPostgres,
} from "../support/database";

let db: TestDatabase;
let runtime: Pool;

const insertUser = async (name: string): Promise<string> => {
  const result = await db.admin.query<{ id: string }>(
    "INSERT INTO identity.users (name, email) VALUES ($1, $2) RETURNING id",
    [name, `${name}@example.test`],
  );
  return result.rows[0]!.id;
};

const insertSubscription = async (userId: string): Promise<string> => {
  const id = randomUUID();
  const endpoint = `https://push.example.test/send/${randomUUID()}`;
  const p256dh = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]);
  const result = await runtime.query<{ id: string }>(
    `INSERT INTO notification.push_subscriptions
       (id, user_id, endpoint, endpoint_hash, p256dh, auth_secret, registration_session_id, device_label, vapid_key_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      id,
      userId,
      endpoint,
      createHash("sha256").update(endpoint).digest(),
      p256dh,
      Buffer.alloc(16, 9),
      "session-1",
      "Pixel 8",
      "2026-10",
    ],
  );
  return result.rows[0]!.id;
};

async function expectPermissionDenied(pool: Pool, sql: string, params: unknown[] = []): Promise<void> {
  await expect(pool.query(sql, params)).rejects.toMatchObject({ code: "42501" });
}

describe("notification schema (push_subscriptions and closed_push_sessions)", () => {
  beforeAll(async () => {
    db = await startPostgres();
    await createRoles(db);
    await migrateAsMigrator(db);
    runtime = db.poolFor("app_runtime");
  }, 120_000);

  afterAll(async () => {
    await db.stop();
  });

  it("app_runtime can SELECT and INSERT on the notification tables", async () => {
    const userId = await insertUser(`push-${randomUUID().slice(0, 8)}`);
    const id = await insertSubscription(userId);
    expect(id).toBeTruthy();

    const rows = await runtime.query<{ id: string }>(
      `SELECT id FROM notification.push_subscriptions WHERE id = $1`,
      [id],
    );
    expect(rows.rows).toHaveLength(1);

    await runtime.query(
      `INSERT INTO notification.closed_push_sessions (session_id, user_id)
       VALUES ($1, $2)`,
      [`closed-session-${randomUUID()}`, userId],
    );
    const closed = await runtime.query<{ session_id: string }>(
      `SELECT session_id FROM notification.closed_push_sessions WHERE user_id = $1`,
      [userId],
    );
    expect(closed.rows).toHaveLength(1);
  });

  it("app_runtime can UPDATE the notification tables", async () => {
    const userId = await insertUser(`push-${randomUUID().slice(0, 8)}`);
    const id = await insertSubscription(userId);
    const rows = await runtime.query<{ enabled: boolean }>(
      `UPDATE notification.push_subscriptions SET enabled = false WHERE id = $1 RETURNING enabled`,
      [id],
    );
    expect(rows.rows[0]!.enabled).toBe(false);
    const sessionId = `closed-session-${randomUUID()}`;
    await runtime.query(
      `INSERT INTO notification.closed_push_sessions (session_id, user_id) VALUES ($1, $2)`,
      [sessionId, userId],
    );
    const updated = await runtime.query<{ session_id: string }>(
      `UPDATE notification.closed_push_sessions SET closed_at = now() - interval '1 minute' WHERE session_id = $1 RETURNING session_id`,
      [sessionId],
    );
    expect(updated.rows).toHaveLength(1);
  });

  it("app_runtime cannot DELETE on the notification tables", async () => {
    const userId = await insertUser(`push-${randomUUID().slice(0, 8)}`);
    const id = await insertSubscription(userId);
    await expectPermissionDenied(
      runtime,
      `DELETE FROM notification.push_subscriptions WHERE id = $1`,
      [id],
    );
    await expectPermissionDenied(
      runtime,
      `DELETE FROM notification.closed_push_sessions WHERE user_id = $1`,
      [userId],
    );
  });
});
