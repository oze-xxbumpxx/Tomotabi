#!/usr/bin/env node
// DevinのPRに、今のheadへのCodexのレビューを頼み、完了を待つ。
// CodexはボットのPR（Devin）を自動ではレビューせず、pushのあとも自動では見直さないため、
// Claude Codeがレビューの流れの中で`@codex review`を投稿する（2026-10-10 ユーザーの指示）。
//
// 使い方:
//   node .claude/scripts/codex-review.mjs request <PR番号>
//     今のheadにCodexのレビューが完了・実行中でなく、自分がそのheadへ依頼していなければ投稿する。
//     投稿は手元のghの認証（ユーザーのアカウント）で行う。Codexは書き込み権限のある人のコメントにだけ反応する。
//     依頼のコメントには対象のheadを印で書き、二重の依頼はその印と作者（自分）で見分ける。
//   node .claude/scripts/codex-review.mjs wait <PR番号> --sha <head> [--since <依頼の時刻>] [--interval 秒] [--timeout 秒]
//     Codexの要約コメントに、そのheadの完了が出るまで待つ。既定は60秒ごと、1時間で諦める。
//     --sinceを渡すと、要約コメントがその時刻より後に更新されるまで、失敗の行を前の試行の結果として扱わない。
//     Claude CodeからはBashのrun_in_backgroundで起動する。
//
// 終了コード:
//   0 … request: 投稿した、または投稿が要らなかった（標準出力のJSON行のactionにposted / skipped）
//       wait: 完了した
//   2 … 引数の誤り
//   3 … wait: 時間切れ
//   4 … PRが閉じた / マージされた
//   5 … wait: Codexのレビューが失敗した
//
// 方針:
// - 判定はcodexStateとrequestDecisionに閉じ込め、テストで固定する。ghの呼び出しは薄くする。
// - Codexの状態は、Codexの要約コメント（`<!-- codex-pull-request-review-summary -->`）の表から読む。
//   行の形は「| 📝 **Code Review** | ✅ **Completed** … | `3141aca` | Draft marked ready |」。
// - 完了の判定はここで閉じる。agent-reviewが求める完了の証拠（作者・編集者・完全SHA）の照合は
//   agent-review.mjsの役目で、このスクリプトは待つきっかけを作るだけ。

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SUMMARY_MARKER = '<!-- codex-pull-request-review-summary -->';
const CODEX_LOGIN = /chatgpt-codex-connector/;
const REQUEST_BODY = '@codex review';
const REQUEST_MARKER = /<!-- tomotabi-codex-request head=([0-9a-f]{40}) -->/;
export const requestBody = (headSha) => `${REQUEST_BODY}\n\n<!-- tomotabi-codex-request head=${headSha} -->`;
const DEFAULT_INTERVAL_SEC = 60;
const DEFAULT_TIMEOUT_SEC = 60 * 60;
const GH_TIMEOUT_MS = 30_000;

/**
 * Codexの要約コメントの本文から、headに対するレビューの状態を返す。
 * @returns {'completed'|'running'|'failed'|'none'}
 */
export function codexState(summaryBody, headSha) {
  if (typeof summaryBody !== 'string' || !summaryBody.includes(SUMMARY_MARKER)) return 'none';
  let state = 'none';
  for (const line of summaryBody.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 5 || !cells[1].includes('Review')) continue;
    const sha = /`([0-9a-f]{7,40})`/.exec(cells[3])?.[1] ?? null;
    if (sha === null || !headSha.startsWith(sha)) continue;
    const status = cells[2];
    if (/Completed/i.test(status)) return 'completed';
    if (/Fail|Error|Cancel/i.test(status)) state = 'failed';
    else if (state === 'none') state = 'running';
  }
  return state;
}

/**
 * 投稿するかを決める。依頼済みと数えるのは、自分（viewer）が今のheadの印を付けて投稿したコメントだけ。
 * コミットの日時はpushの時刻と一致しないので使わない。権限の無い人のコメントにはCodexが反応しないので数えない。
 * @param {{headSha:string, viewer:string, summaryBody:string|null,
 *   requests:Array<{body:string, author:string}>}} input
 * @returns {{action:'posted'|'skipped', reason:string}}
 */
export function requestDecision({ headSha, viewer, summaryBody, requests }) {
  const state = codexState(summaryBody, headSha);
  if (state === 'completed') return { action: 'skipped', reason: 'completed' };
  if (state === 'running') return { action: 'skipped', reason: 'running' };
  const requested = requests.some(
    (comment) => comment.author === viewer && REQUEST_MARKER.exec(comment.body)?.[1] === headSha,
  );
  if (requested && state !== 'failed') return { action: 'skipped', reason: 'requested' };
  return { action: 'posted', reason: state === 'failed' ? 'retry' : 'new' };
}

export function parseArgs(argv) {
  const [command, prArg, ...rest] = argv;
  const pr = Number(prArg);
  if (!['request', 'wait'].includes(command) || !Number.isInteger(pr) || pr <= 0) return null;
  const args = { command, pr, sha: null, since: null, interval: DEFAULT_INTERVAL_SEC, timeout: DEFAULT_TIMEOUT_SEC };
  for (let i = 0; i < rest.length; i += 2) {
    const [key, value] = [rest[i], rest[i + 1]];
    if (value === undefined) return null;
    if (key === '--sha') {
      if (!/^[0-9a-f]{7,40}$/.test(value)) return null;
      args.sha = value;
    } else if (key === '--since') {
      if (Number.isNaN(Date.parse(value))) return null;
      args.since = value;
    } else if (key === '--interval' || key === '--timeout') {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return null;
      args[key.slice(2)] = n;
    } else {
      return null;
    }
  }
  if (command === 'wait' && args.sha === null) return null;
  if (command === 'request' && rest.length > 0) return null;
  return args;
}

/**
 * waitの終了判定。失敗の行は、要約コメントが依頼の時刻（since）より後に更新されていなければ
 * 前の試行の結果なので、まだ待つ。
 * @returns {'completed'|'failed'|'waiting'}
 */
export function waitOutcome({ summaryBody, summaryUpdatedAt, headSha, since = null }) {
  const state = codexState(summaryBody, headSha);
  if (state === 'completed') return 'completed';
  if (state !== 'failed') return 'waiting';
  if (since !== null && !(Date.parse(summaryUpdatedAt ?? '') > Date.parse(since))) return 'waiting';
  return 'failed';
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS });
}

function viewPr(pr) {
  // gh pr view --json commentsはupdatedAtを返さないので、要約コメントの更新時刻はREST APIで読む。
  const view = JSON.parse(gh(['pr', 'view', String(pr), '--json', 'state,headRefOid']));
  const comments = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/{owner}/{repo}/issues/${pr}/comments`])).flat();
  const summary = comments
    .filter((comment) => CODEX_LOGIN.test(comment.user?.login ?? '') && comment.body.includes(SUMMARY_MARKER))
    .at(-1);
  return {
    state: view.state,
    headSha: view.headRefOid,
    summaryBody: summary?.body ?? null,
    summaryUpdatedAt: summary?.updated_at ?? null,
    requests: comments.map((comment) => ({ body: comment.body, author: comment.user?.login ?? '' })),
  };
}

const viewerLogin = () => gh(['api', 'user', '--jq', '.login']).trim();

const sleep = (sec) => new Promise((resolve) => setTimeout(resolve, sec * 1000));

function request(args) {
  const pr = viewPr(args.pr);
  if (pr.state !== 'OPEN') {
    console.log(JSON.stringify({ pr: args.pr, state: pr.state }));
    process.exit(4);
  }
  const decision = requestDecision({ ...pr, viewer: viewerLogin() });
  const requestedAt = new Date().toISOString();
  if (decision.action === 'posted') gh(['pr', 'comment', String(args.pr), '--body', requestBody(pr.headSha)]);
  console.log(
    JSON.stringify({ pr: args.pr, headSha: pr.headSha, ...decision, requestedAt: decision.action === 'posted' ? requestedAt : null }),
  );
  process.exit(0);
}

async function wait(args) {
  const deadline = Date.now() + args.timeout * 1000;
  console.log(`PR #${args.pr} の ${args.sha} へのCodexのレビューの完了を待っています（${args.interval} 秒ごと）`);
  for (;;) {
    try {
      const pr = viewPr(args.pr);
      if (pr.state !== 'OPEN') {
        console.log(JSON.stringify({ pr: args.pr, state: pr.state }));
        process.exit(4);
      }
      const state = waitOutcome({ ...pr, headSha: args.sha, since: args.since });
      if (state !== 'waiting') {
        console.log(JSON.stringify({ pr: args.pr, headSha: args.sha, codex: state }));
        process.exit(state === 'completed' ? 0 : 5);
      }
    } catch (error) {
      console.error(`gh の確認に失敗しました（次の周期で再試行）: ${error.message.split('\n')[0]}`);
    }
    if (Date.now() + args.interval * 1000 > deadline) {
      console.log(`時間切れ: PR #${args.pr} の Codex のレビューは完了しませんでした`);
      process.exit(3);
    }
    await sleep(args.interval);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error(
      'usage: codex-review.mjs request <PR番号> | codex-review.mjs wait <PR番号> --sha <head> [--since <ISO 8601>] [--interval 秒] [--timeout 秒]',
    );
    process.exit(2);
  }
  if (args.command === 'request') request(args);
  else await wait(args);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
