// migrationを流す前とあとで、DBに最後に流したmigrationの時刻を読む。
// 設計: docs/designs/migration-workflow.md
//
// 使い方: node .github/scripts/read-last-migration-time.mjs
// 環境変数: MIGRATION_DATABASE_URL（migratorの直接の接続。必須）
//
// 標準出力に、drizzle.__drizzle_migrationsのmax(created_at)の数だけを1行で出す
// （1本も無ければ0）。失敗したときは、元のエラーの文字列を出さず
// 「DBにつながりませんでした」だけを標準エラーに出して終了コード1にする。
// pgのエラーには接続先が入ることがあるので、エラーのmessageはどこにも出さない。
//
// ワークフローを動かした版（github.sha）から別の場所に取り出して使う。
// pgはnpm ciした作業ツリーのnode_modulesから解決する（このファイルの場所から上に辿る）。
const QUERY = 'select coalesce(max(created_at), 0)::text as last from drizzle.__drizzle_migrations';
const CONNECT_ERROR = 'DBにつながりませんでした';

async function connectWithPg(url) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

/**
 * 本体。終了コードを返す。試験のため、接続と出力は引数で差し替えられる。
 */
export async function main({
  env = process.env,
  connect = connectWithPg,
  log = console.log,
  error = console.error,
} = {}) {
  const url = env.MIGRATION_DATABASE_URL;
  if (typeof url !== 'string' || url.trim() === '') {
    error('MIGRATION_DATABASE_URLが設定されていません');
    return 1;
  }
  let client;
  try {
    client = await connect(url);
    const result = await client.query(QUERY);
    log(String(result.rows[0].last));
  } catch {
    error(CONNECT_ERROR);
    return 1;
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        // 読み取りの結果は出ているので、閉じる失敗は無視する
      }
    }
  }
  return 0;
}

if (import.meta.main) {
  process.exitCode = await main();
}
