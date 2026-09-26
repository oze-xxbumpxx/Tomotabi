#!/usr/bin/env node
// レビュー指摘を PR に投稿したあと、PR が更新される（新しい head のコミット → CI 完了）まで待つ。
// 設計: docs/designs/devin-delegation-loop.md
//
// 使い方:
//   node .claude/scripts/wait-for-pr-update.mjs <PR番号> --since <ISO 8601> [--sha <レビューした head>]
//     [--interval 秒] [--timeout 秒] [--grace 秒]
//     既定: 60 秒ごとに確認し、4 時間で諦める。
//   Claude Code からは Bash の run_in_background で起動する。終了するとセッションが呼び戻される。
//
// 終了コード:
//   0 … 更新あり。標準出力に {"pr","state","headSha","ciConclusion","newCommits"} の JSON を 1 行出す
//       ciConclusion は success | failure | none（チェックが無い）。失敗でも 0 で返す
//       （Devin が CI を直している途中かは Claude が判断し、必要ならもう一度待つ）
//   2 … 引数の誤り
//   3 … 時間切れ
//   4 … PR が閉じた / マージされた（JSON 行の state に CLOSED / MERGED）
//
// 方針:
// - 判定は detectUpdate に閉じ込め、テストで固定する。gh の呼び出しは薄くする（wait-for-pr.mjs と同じ）。
// - 「更新」は head が --sha と違う（--sha が無ければ head のコミット時刻が --since より後）こと。
// - push の直後はチェックがまだ登録されていないことがあるため、チェックが 0 件のときは
//   その head を初めて見てから --grace 秒（既定 180 秒）待ってから「チェックなし」とみなす。
// - gh の一時的な失敗では止めず、次の周期で再試行する。gh には 30 秒のタイムアウトを付ける。

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_INTERVAL_SEC = 60;
const DEFAULT_TIMEOUT_SEC = 4 * 60 * 60;
const DEFAULT_GRACE_SEC = 180;
const GH_TIMEOUT_MS = 30_000;

const FAILED_CHECK_RUN = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const PENDING_STATUS = new Set(['PENDING', 'EXPECTED']);
const FAILED_STATUS = new Set(['FAILURE', 'ERROR']);

const isCheckRun = (item) => item.__typename === 'CheckRun' || 'conclusion' in item;

/** statusCheckRollup のすべてが完了しているか。CheckRun と StatusContext（commit status）が混在する。 */
export function checksComplete(rollup) {
  return rollup.every((item) => (isCheckRun(item) ? item.status === 'COMPLETED' : !PENDING_STATUS.has(item.state)));
}

/** 完了済みの statusCheckRollup の結論。0 件なら none。 */
export function ciConclusion(rollup) {
  if (rollup.length === 0) return 'none';
  const failed = rollup.some((item) =>
    isCheckRun(item) ? FAILED_CHECK_RUN.has(item.conclusion) : FAILED_STATUS.has(item.state),
  );
  return failed ? 'failure' : 'success';
}

/**
 * @param {{state:string, headRefOid:string, commits?:Array<{oid:string,committedDate:string}>,
 *   statusCheckRollup?:Array<object>}} pr gh pr view の JSON
 * @param {{since:string, sha?:string|null, headSeenAtMs?:number|null, nowMs:number, graceSec?:number}} opts
 *   headSeenAtMs はこの head を初めて見た時刻（チェック 0 件の猶予の起点）。
 * @returns {{status:'waiting'|'updated'|'closed', headSha:string, ciConclusion:string|null, newCommits:number}}
 */
export function detectUpdate(pr, { since, sha = null, headSeenAtMs = null, nowMs, graceSec = DEFAULT_GRACE_SEC }) {
  const sinceMs = Date.parse(since);
  const commits = pr.commits ?? [];
  const newCommits = commits.filter((c) => Date.parse(c.committedDate) > sinceMs).length;
  const base = { headSha: pr.headRefOid, newCommits };
  if (pr.state !== 'OPEN') return { status: 'closed', ciConclusion: null, ...base };

  const head = commits.at(-1);
  const moved =
    sha !== null ? !pr.headRefOid.startsWith(sha) : head !== undefined && Date.parse(head.committedDate) > sinceMs;
  if (!moved) return { status: 'waiting', ciConclusion: null, ...base };

  const rollup = pr.statusCheckRollup ?? [];
  if (rollup.length === 0) {
    const seenAt = headSeenAtMs ?? nowMs;
    if (nowMs - seenAt < graceSec * 1000) return { status: 'waiting', ciConclusion: null, ...base };
  } else if (!checksComplete(rollup)) {
    return { status: 'waiting', ciConclusion: null, ...base };
  }
  return { status: 'updated', ciConclusion: ciConclusion(rollup), ...base };
}

export function parseArgs(argv) {
  const [prArg, ...rest] = argv;
  const pr = Number(prArg);
  if (!Number.isInteger(pr) || pr <= 0) return null;
  const args = {
    pr,
    since: null,
    sha: null,
    interval: DEFAULT_INTERVAL_SEC,
    timeout: DEFAULT_TIMEOUT_SEC,
    grace: DEFAULT_GRACE_SEC,
  };
  for (let i = 0; i < rest.length; i += 2) {
    const [key, value] = [rest[i], rest[i + 1]];
    if (value === undefined) return null;
    if (key === '--since') {
      if (Number.isNaN(Date.parse(value))) return null;
      args.since = value;
    } else if (key === '--sha') {
      if (!/^[0-9a-f]{7,40}$/.test(value)) return null;
      args.sha = value;
    } else if (['--interval', '--timeout', '--grace'].includes(key)) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return null;
      args[key.slice(2)] = n;
    } else {
      return null;
    }
  }
  return args.since === null ? null : args;
}

function viewPr(pr) {
  const out = execFileSync(
    'gh',
    ['pr', 'view', String(pr), '--json', 'state,headRefOid,commits,statusCheckRollup'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS },
  );
  return JSON.parse(out);
}

const sleep = (sec) => new Promise((resolve) => setTimeout(resolve, sec * 1000));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error(
      'usage: wait-for-pr-update.mjs <PR番号> --since <ISO 8601> [--sha <sha>] [--interval 秒] [--timeout 秒] [--grace 秒]',
    );
    process.exit(2);
  }
  const deadline = Date.now() + args.timeout * 1000;
  console.log(`PR #${args.pr} の更新（${args.since} より後のコミット → CI 完了）を待っています（${args.interval} 秒ごと）`);
  const seenAt = new Map();
  for (;;) {
    try {
      const pr = viewPr(args.pr);
      if (!seenAt.has(pr.headRefOid)) seenAt.set(pr.headRefOid, Date.now());
      const result = detectUpdate(pr, {
        since: args.since,
        sha: args.sha,
        headSeenAtMs: seenAt.get(pr.headRefOid),
        nowMs: Date.now(),
        graceSec: args.grace,
      });
      if (result.status !== 'waiting') {
        const line = JSON.stringify({
          pr: args.pr,
          state: pr.state,
          headSha: result.headSha,
          ciConclusion: result.ciConclusion,
          newCommits: result.newCommits,
        });
        if (result.status === 'closed') {
          console.log(`PR #${args.pr} は ${pr.state} になりました`);
          console.log(line);
          process.exit(4);
        }
        console.log(`PR #${args.pr} が更新されました（CI: ${result.ciConclusion}）`);
        console.log(line);
        process.exit(0);
      }
    } catch (error) {
      console.error(`gh の確認に失敗しました（次の周期で再試行）: ${error.message.split('\n')[0]}`);
    }
    if (Date.now() + args.interval * 1000 > deadline) {
      console.log(`時間切れ: PR #${args.pr} は更新されませんでした`);
      process.exit(3);
    }
    await sleep(args.interval);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
