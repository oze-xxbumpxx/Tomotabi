import { Pool } from "pg";

let pool: Pool | undefined;

export function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 10_000,
    });
    // アイドル接続の非同期エラー（DB 停止等）を握りつぶす。listener が無いと
    // EventEmitter の error イベントがプロセスを落とす。実クエリの失敗は
    // 各呼び出しの reject で処理する。
    pool.on("error", () => {});
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.end();
  pool = undefined;
}
