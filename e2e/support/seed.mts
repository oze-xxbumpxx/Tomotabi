import type { Pool } from "pg";

export type SeededUsers = {
  hinataUserId: string;
  aoiUserId: string;
};

async function insertUser(
  admin: Pool,
  name: string,
  email: string,
): Promise<string> {
  const result = await admin.query<{ id: string }>(
    "INSERT INTO identity.users (name, email, email_verified) VALUES ($1, $2, TRUE) RETURNING id",
    [name, email],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("INSERT INTO identity.users returned no id");
  }
  return row.id;
}

async function insertAllowedUser(
  admin: Pool,
  name: string,
  email: string,
  slot: number,
): Promise<string> {
  const userId = await insertUser(admin, name, email);
  const sub = `e2e-sub-${slot}`;
  await admin.query(
    "INSERT INTO identity.accounts (account_id, provider_id, user_id) VALUES ($1, 'google', $2)",
    [sub, userId],
  );
  await admin.query(
    `INSERT INTO identity.allowed_google_accounts (slot, user_id, google_sub, enabled)
     VALUES ($1, $2, $3, TRUE)`,
    [slot, userId, sub],
  );
  return userId;
}

/**
 * ひなた（slot 0）・あおい（slot 1）を利用者・許可リストに入れる。
 * run.mjs から 1 回だけ呼ぶ（M1 と同じ架空の値。メールは @example.test）。
 */
export async function seedUsers(admin: Pool): Promise<SeededUsers> {
  return {
    hinataUserId: await insertAllowedUser(admin, "ひなた", "hinata@example.test", 0),
    aoiUserId: await insertAllowedUser(admin, "あおい", "aoi@example.test", 1),
  };
}
