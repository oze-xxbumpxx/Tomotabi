import type { Pool } from "pg";
import type { Slot } from "../shared/slot";

export type EnrollmentRecord = {
  slot: Slot;
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
};

/**
 * users → accounts（トークン列は null）→ allowed_google_accounts を 1 トランザクションで INSERT する。
 * slot / sub / email の重複は一意制約違反（23505）として throw し、全件ロールバックする。
 * 管理者接続（migrator）で実行する。app_runtime には INSERT 権限が無い。
 */
export async function insertEnrollment(pool: Pool, record: EnrollmentRecord): Promise<{ userId: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query<{ id: string }>(
      "INSERT INTO identity.users (name, email, email_verified) VALUES ($1, $2, $3) RETURNING id",
      [record.name, record.email, record.emailVerified],
    );
    const userId = user.rows[0]!.id;
    await client.query("INSERT INTO identity.accounts (account_id, provider_id, user_id) VALUES ($1, 'google', $2)", [
      record.sub,
      userId,
    ]);
    await client.query(
      "INSERT INTO identity.allowed_google_accounts (slot, user_id, google_sub, enabled) VALUES ($1, $2, $3, TRUE)",
      [record.slot, userId, record.sub],
    );
    await client.query("COMMIT");
    return { userId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
