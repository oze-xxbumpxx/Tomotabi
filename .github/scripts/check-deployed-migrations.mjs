// デプロイの前に、DBに流したmigrationが出すcommitに追いついているかを確かめる。
// 設計: docs/designs/migration-deploy-check.md
//
// 使い方: node .github/scripts/check-deployed-migrations.mjs <API_ORIGIN> <出すcommitの_journal.jsonのパス>
//
// 終了コード: 0 通す（DBが同じか新しい・口がまだ無い） / 1 止める（それ以外すべて）
//
// ワークフローを動かした版（mainの先頭）から取り出して動かす。出すcommitの作業ツリーには置かない。
// この機能より前のcommitへ戻して出すときも、確かめの手順で止まらないようにするため。
// そのため依存を持たず、Nodeの標準だけを使う。
import { appendFile, readFile as readFileFromDisk } from 'node:fs/promises';

const TIMEOUT_MS = 10_000;
const RUNBOOK = 'docs/runbooks/production.md の10章';

const usage = 'usage: node .github/scripts/check-deployed-migrations.mjs <API_ORIGIN> <_journal.jsonのパス>';

/**
 * `_journal.json`の中で`when`が最大の行。並び順には頼らない。
 * @throws `entries`が無い・空・`when`か`tag`の形が違うとき
 */
export function lastJournalEntry(journal) {
  const entries = journal?.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('_journal.jsonにmigrationがありません');
  }
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry?.when) || typeof entry?.tag !== 'string') {
      throw new Error('_journal.jsonの行の形が違います');
    }
  }
  return entries.reduce((last, entry) => (entry.when > last.when ? entry : last));
}

/**
 * 今のapiの答えと出すcommitの`_journal.json`を比べる。
 * `response`は`{ status, body }`（bodyは本文の文字列）か`{ error }`。
 * @returns {{ result: 'pass' | 'warn' | 'fail', message: string, missing: string[], applied: number | null, expected: number | null }}
 */
export function compareMigrations({ journal, response }) {
  let last;
  try {
    last = lastJournalEntry(journal);
  } catch (error) {
    return fail(`出すcommitの_journal.jsonを読めません: ${error.message}`);
  }
  const expected = last.when;

  if ('error' in response) {
    return fail(`今のapiにつながりません: ${describeError(response.error)}`, { expected });
  }
  if (response.status === 404) {
    return {
      result: 'warn',
      message:
        '今のapiに確かめの口がまだありません（この機能を最初に出す1回、またはこの機能より前のcommitへ戻したあとの1回）。確かめずに進みます',
      missing: [],
      applied: null,
      expected,
    };
  }
  if (response.status !== 200) {
    return fail(`今のapiが${response.status}を返しました`, { expected });
  }

  let body;
  try {
    body = JSON.parse(response.body);
  } catch {
    return fail('今のapiの答えがJSONではありません', { expected });
  }
  const valid =
    body !== null &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    'lastAppliedAt' in body &&
    (body.lastAppliedAt === null || Number.isSafeInteger(body.lastAppliedAt));
  if (!valid) {
    return fail('今のapiの答えの形が違います', { expected });
  }

  const applied = body.lastAppliedAt;
  if (applied !== null && applied >= expected) {
    return { result: 'pass', message: 'DBのmigrationは出すcommitに追いついています', missing: [], applied, expected };
  }
  const missing = journal.entries
    .filter((entry) => applied === null || entry.when > applied)
    .sort((a, b) => a.when - b.when)
    .map((entry) => entry.tag);
  return {
    result: 'fail',
    message: `DBに流していないmigrationがあります: ${missing.join(', ')}。管理者の端末でmigrationを流してから、もう一度出してください（${RUNBOOK}）`,
    missing,
    applied,
    expected,
  };
}

function fail(message, { expected = null } = {}) {
  return { result: 'fail', message, missing: [], applied: null, expected };
}

function describeError(error) {
  if (error?.name === 'TimeoutError') return `${TIMEOUT_MS / 1000}秒で答えがありませんでした`;
  return error?.message ?? String(error);
}

function summaryLines({ result, message, missing, applied, expected }) {
  const lines = ['## migrationの確かめ', ''];
  lines.push(`- 結果: ${result === 'pass' ? '通す' : result === 'warn' ? '警告して通す' : '止める'}`);
  lines.push(`- DBの最後のmigrationの時刻: ${applied ?? 'なし'}`);
  lines.push(`- 出すcommitの最後のmigrationの時刻: ${expected ?? '読めない'}`);
  if (missing.length > 0) lines.push(`- 足りないmigration: ${missing.join(', ')}`);
  lines.push('', message, '');
  return lines.join('\n');
}

/**
 * 本体。終了コードを返す。試験のため、外とのやりとりは引数で差し替えられる。
 */
export async function main(
  argv,
  {
    fetchImpl = fetch,
    readFile = (path) => readFileFromDisk(path, 'utf8'),
    summaryPath = process.env.GITHUB_STEP_SUMMARY,
    log = console.log,
  } = {},
) {
  const [origin, journalPath] = argv;
  if (!origin || !journalPath) {
    log(usage);
    return 1;
  }

  let journal;
  try {
    journal = JSON.parse(await readFile(journalPath));
    lastJournalEntry(journal);
  } catch (error) {
    const outcome = fail(`出すcommitの_journal.jsonを読めません: ${error.message}`);
    return report(outcome, { summaryPath, log });
  }

  const url = `${origin.replace(/\/+$/, '')}/api/health/migrations`;
  let response;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual' });
    response = { status: res.status, body: await res.text() };
  } catch (error) {
    response = { error };
  }
  return report(compareMigrations({ journal, response }), { summaryPath, log });
}

async function report(outcome, { summaryPath, log }) {
  const level = outcome.result === 'pass' ? 'notice' : outcome.result === 'warn' ? 'warning' : 'error';
  log(`::${level}::${outcome.message}`);
  if (summaryPath) {
    await appendFile(summaryPath, summaryLines(outcome));
  }
  return outcome.result === 'fail' ? 1 : 0;
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
