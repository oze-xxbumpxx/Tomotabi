import { Pool } from "pg";
import { CliUsageError, requireEnv } from "./slot";

type PgError = Error & { code: string; constraint?: string };

const isPgError = (error: unknown): error is PgError =>
  error instanceof Error && typeof (error as { code?: unknown }).code === "string";

/**
 * 標準出力に出して安全な説明だけを返す。pg のエラーは detail に行の値（sub など）を含むため、
 * SQLSTATE と制約名だけにする。
 */
export function describeFailure(error: unknown): string {
  if (isPgError(error)) {
    const constraint = error.constraint ? ` (${error.constraint})` : "";
    if (error.code === "23505") {
      return `既に登録されています${constraint}。ロールバックしました。`;
    }
    return `DB エラー SQLSTATE ${error.code}${constraint}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "不明なエラー";
}

/**
 * CLI 共通の入口。MIGRATION_DATABASE_URL で Pool を作り、終了コードを返す（成功 0、使い方 2、失敗 1）。
 */
export async function runCli(main: (pool: Pool) => Promise<void>): Promise<number> {
  let pool: Pool | null = null;
  try {
    pool = new Pool({
      connectionString: requireEnv("MIGRATION_DATABASE_URL"),
      max: 1,
    });
    await main(pool);
    return 0;
  } catch (error) {
    process.stderr.write(`${describeFailure(error)}\n`);
    return error instanceof CliUsageError ? 2 : 1;
  } finally {
    await pool?.end();
  }
}
