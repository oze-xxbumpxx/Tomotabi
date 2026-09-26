import type { Pool } from "pg";
import type { Slot } from "../shared/slot";

export type DisableResult = { userId: string; deletedSessions: number };

export class SlotNotEnrolledError extends Error {
  constructor(readonly slot: Slot) {
    super(`slot ${slot} は登録されていません。`);
    this.name = "SlotNotEnrolledError";
  }
}

/**
 * allowed_google_accounts.enabled = false と、その user_id の sessions の DELETE を 1 トランザクションで行う。
 * 再実行しても同じ結果で成功する（enabled は false のまま、削除件数は 0）。
 * @throws SlotNotEnrolledError slot に登録が無いとき（何も変更しない）
 */
export async function disableGoogleAccount(pool: Pool, slot: Slot): Promise<DisableResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query<{ user_id: string }>(
      "UPDATE identity.allowed_google_accounts SET enabled = FALSE WHERE slot = $1 RETURNING user_id",
      [slot],
    );
    const userId = updated.rows[0]?.user_id;
    if (userId === undefined) {
      throw new SlotNotEnrolledError(slot);
    }
    const deleted = await client.query("DELETE FROM identity.sessions WHERE user_id = $1", [userId]);
    await client.query("COMMIT");
    return { userId, deletedSessions: deleted.rowCount ?? 0 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
