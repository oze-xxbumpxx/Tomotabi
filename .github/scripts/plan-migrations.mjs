// migrationのボタンで、承認の前に「これから流すmigration」の一覧を作る。
// 設計: docs/designs/migration-workflow.md
//
// 使い方: node .github/scripts/plan-migrations.mjs <apiのURL> <_journal.jsonのパス> [apiのURLの変数名] [--backup-reminder]
//
// 終了コード: 0 一覧を出した（一覧を出せないときも承認へ進む）/ 1 止める（_journal.jsonが読めない・DBに1本も流していない）
//
// ワークフローを動かした版（github.sha）から取り出して動かす。流すcommitの作業ツリーには置かない。
// この機能より前のcommitへ戻すときも同じ理由で、依存を持たずNode 24の標準だけを使う。
// apiの答えと_journal.jsonの比べ方は、デプロイの確かめ（check-deployed-migrations.mjs）と同じにする。
import { appendFile, readFile as readFileFromDisk } from 'node:fs/promises';
import { compareMigrations, lastJournalEntry } from './check-deployed-migrations.mjs';

const TIMEOUT_MS = 10_000;
const BACKUP_REMINDER =
  '本番でDBを変える前に、バックアップを取って戻して照合しましたか。取っていなければ承認せずに止めてください（docs/runbooks/backup-and-restore.md）';
const FIRST_BUILD_REASON =
  'DBにmigrationが1本も流れていません。ロールを作る最初の構築は、管理者の端末で行ってください';

const usage =
  'usage: node .github/scripts/plan-migrations.mjs <apiのURL> <_journal.jsonのパス> [apiのURLの変数名] [--backup-reminder]';

/**
 * 今のapiの答えと流すcommitの`_journal.json`から、一覧の状態を決める。
 * `answer`は`{ status, body }`（bodyは本文の文字列）か`{ error }`。
 * @returns {{ state: 'none' | 'pending' | 'unknown' | 'stop', count: number, names: string[], reason: string | null }}
 */
export function planMigrations(journal, answer) {
  const outcome = compareMigrations({ journal, response: answer });
  if (outcome.result === 'pass') {
    return { state: 'none', count: 0, names: [], reason: null };
  }
  if (outcome.result === 'warn') {
    return {
      state: 'unknown',
      count: 0,
      names: [],
      reason:
        '今のapiに確かめの口がまだありません（この機能を最初に出す1回、またはこの機能より前のcommitへ戻したあとの1回）',
    };
  }
  if (outcome.result === 'fail') {
    if (outcome.expected === null) {
      // _journal.jsonの形が違う。mainは手前で止めるので、ここには来ないはず。
      return { state: 'stop', count: 0, names: [], reason: outcome.message };
    }
    if (outcome.applied === null && outcome.missing.length > 0) {
      // 200でlastAppliedAtがnull。DBに1本も流していない（最初の構築。要件B-02）。
      return { state: 'stop', count: 0, names: [], reason: FIRST_BUILD_REASON };
    }
    if (outcome.missing.length > 0) {
      return { state: 'pending', count: outcome.missing.length, names: outcome.missing, reason: null };
    }
  }
  return { state: 'unknown', count: 0, names: [], reason: outcome.message };
}

function apiTarget(origin, originVarName) {
  const trimmed = typeof origin === 'string' ? origin.trim() : '';
  let url = null;
  try {
    if (new URL(trimmed).protocol === 'https:') {
      url = `${trimmed.replace(/\/+$/, '')}/api/health/migrations`;
    }
  } catch {
    url = null;
  }
  if (url === null) {
    return {
      url: null,
      host: null,
      reason: `apiのURLの変数（${originVarName}）が空か、https://で始まるURLではありません`,
    };
  }
  return { url, host: new URL(url).hostname, reason: null };
}

async function askApi(fetchImpl, url) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual' });
    return { status: res.status, body: await res.text() };
  } catch (error) {
    return { error };
  }
}

function summaryText(plan, { apiHost, backupReminder, env }) {
  const lines = ['## migrationのボタン', ''];
  if (env.ENVIRONMENT_NAME) lines.push(`- 環境: ${env.ENVIRONMENT_NAME}`);
  if (env.TARGET_SHA) lines.push(`- commit: \`${env.TARGET_SHA}\``);
  lines.push(`- api: ${apiHost ?? '（URLを読めませんでした）'}`);
  lines.push('');
  if (plan.state === 'none') {
    lines.push('- 結果: 流すものはありません');
  } else if (plan.state === 'pending') {
    lines.push(`- 結果: 承認すると${plan.count}本流します`);
    lines.push('- これから流すmigration（流す順）:');
    for (const name of plan.names) lines.push(`  - ${name}`);
  } else if (plan.state === 'unknown') {
    lines.push('- 結果: 一覧を出せません');
    lines.push(`  - ${plan.reason}`);
    lines.push('- 承認すると、DBの履歴を見て、流していないものだけを流します');
  } else {
    lines.push('- 結果: 止めます');
    lines.push(`  - ${plan.reason}`);
  }
  if (backupReminder && (plan.state === 'pending' || plan.state === 'unknown')) {
    lines.push('', BACKUP_REMINDER);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function logLine(plan) {
  if (plan.state === 'none') return '流すものはありません';
  if (plan.state === 'pending') {
    return `これから流すmigrationがあります: ${plan.names.join(', ')}。承認のあとに流します`;
  }
  if (plan.state === 'unknown') {
    return `一覧を出せません: ${plan.reason}。承認のあとに、DBの履歴を見て流していないものだけを流します`;
  }
  return plan.reason;
}

async function finish(plan, context, { summaryPath, outputPath, log }) {
  if (summaryPath) {
    await appendFile(summaryPath, summaryText(plan, context));
  }
  if (outputPath && plan.state !== 'stop') {
    await appendFile(outputPath, `state=${plan.state}\ncount=${plan.count}\n`);
  }
  const level = plan.state === 'stop' ? 'error' : plan.state === 'unknown' ? 'warning' : 'notice';
  log(`::${level}::${logLine(plan)}`);
  return plan.state === 'stop' ? 1 : 0;
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
    outputPath = process.env.GITHUB_OUTPUT,
    log = console.log,
    env = process.env,
  } = {},
) {
  const backupReminder = argv.includes('--backup-reminder');
  const positional = argv.filter((arg) => arg !== '--backup-reminder');
  const [origin, journalPath, originVar] = positional;
  if (origin === undefined || journalPath === undefined) {
    log(usage);
    return 1;
  }
  const context = {
    apiHost: null,
    backupReminder,
    env,
  };
  const sinks = { summaryPath, outputPath, log };

  let journal;
  try {
    journal = JSON.parse(await readFile(journalPath));
    lastJournalEntry(journal);
  } catch (error) {
    return finish(
      {
        state: 'stop',
        count: 0,
        names: [],
        reason: `流すcommitの_journal.jsonを読めません: ${error.message}`,
      },
      context,
      sinks,
    );
  }

  const target = apiTarget(origin, originVar || 'apiのURLの変数');
  let plan;
  if (target.url === null) {
    plan = { state: 'unknown', count: 0, names: [], reason: target.reason };
  } else {
    context.apiHost = target.host;
    plan = planMigrations(journal, await askApi(fetchImpl, target.url));
  }
  return finish(plan, context, sinks);
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
