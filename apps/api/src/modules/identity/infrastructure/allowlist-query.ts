import type { Pool } from "pg";

/**
 * 利用許可の共通判定。セッション発行時のdatabaseHooksと、要求ごとの
 * SessionVerifierの両方がこのクエリを使う（判定のずれを防ぐため分けない）。
 *
 * identity.accountsのgoogle行（account_id = Googleのsub）と
 * identity.allowed_google_accountsのuser_id・google_sub・enabledを突き合わせる。
 * app_runtimeは両表ともSELECTのみで足りる。
 */
export async function isAllowedGoogleAccount(
  pool: Pool,
  userId: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
       FROM identity.allowed_google_accounts AS allowlist
       JOIN identity.accounts AS accounts
         ON accounts.user_id = allowlist.user_id
        AND accounts.provider_id = 'google'
        AND accounts.account_id = allowlist.google_sub
      WHERE allowlist.user_id = $1
        AND allowlist.enabled = TRUE
      LIMIT 1`,
    [userId],
  );
  return result.rowCount === 1;
}
