#!/usr/bin/env node
// DevinのPRに、今のheadへのCodexのレビューを頼み、完了を待つ。
// CodexはボットのPR（Devin）を自動ではレビューせず、pushのあとも自動では見直さないため、
// Claude Codeがレビューの流れの中で`@codex review`を投稿する（2026-10-10 ユーザーの指示）。
//
// 使い方:
//   node .claude/scripts/codex-review.mjs request <PR番号>
//     今のheadにCodexのレビューが完了・実行中でなく、headのコミットより後に`@codex review`も無ければ投稿する。
//     投稿は手元のghの認証（ユーザーのアカウント）で行う。Codexは書き込み権限のある人のコメントにだけ反応する。
//   node .claude/scripts/codex-review.mjs wait <PR番号> --sha <head> [--interval 秒] [--timeout 秒]
//     Codexの要約コメントに、そのheadの完了が出るまで待つ。既定は60秒ごと、1時間で諦める。
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
 * 投稿するかを決める。
 * @param {{headSha:string, headCommittedAt:string, summaryBody:string|null,
 *   requests:Array<{body:string, createdAt:string}>}} input
 * @returns {{action:'posted'|'skipped', reason:string}}
 */
export function requestDecision({ headSha, headCommittedAt, summaryBody, requests }) {
  const state = codexState(summaryBody, headSha);
  if (state === 'completed') return { action: 'skipped', reason: 'completed' };
  if (state === 'running') return { action: 'skipped', reason: 'running' };
  const headMs = Date.parse(headCommittedAt);
  const requested = requests.some(
    (comment) => comment.body.trim().startsWith(REQUEST_BODY) && Date.parse(comment.createdAt) > headMs,
  );
  if (requested && state !== 'failed') return { action: 'skipped', reason: 'requested' };
  return { action: 'posted', reason: state === 'failed' ? 'retry' : 'new' };
}

export function parseArgs(argv) {
  const [command, prArg, ...rest] = argv;
  const pr = Number(prArg);
  if (!['request', 'wait'].includes(command) || !Number.isInteger(pr) || pr <= 0) return null;
  const args = { command, pr, sha: null, interval: DEFAULT_INTERVAL_SEC, timeout: DEFAULT_TIMEOUT_SEC };
  for (let i = 0; i < rest.length; i += 2) {
    const [key, value] = [rest[i], rest[i + 1]];
    if (value === undefined) return null;
    if (key === '--sha') {
      if (!/^[0-9a-f]{7,40}$/.test(value)) return null;
      args.sha = value;
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

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS });
}

function viewPr(pr) {
  const view = JSON.parse(gh(['pr', 'view', String(pr), '--json', 'state,headRefOid,commits,comments']));
  const summary = view.comments
    .filter((comment) => CODEX_LOGIN.test(comment.author?.login ?? '') && comment.body.includes(SUMMARY_MARKER))
    .at(-1);
  const head = view.commits.at(-1);
  return {
    state: view.state,
    headSha: view.headRefOid,
    headCommittedAt: head?.committedDate ?? new Date(0).toISOString(),
    summaryBody: summary?.body ?? null,
    requests: view.comments.map((comment) => ({ body: comment.body, createdAt: comment.createdAt })),
  };
}

const sleep = (sec) => new Promise((resolve) => setTimeout(resolve, sec * 1000));

function request(args) {
  const pr = viewPr(args.pr);
  if (pr.state !== 'OPEN') {
    console.log(JSON.stringify({ pr: args.pr, state: pr.state }));
    process.exit(4);
  }
  const decision = requestDecision(pr);
  if (decision.action === 'posted') gh(['pr', 'comment', String(args.pr), '--body', REQUEST_BODY]);
  console.log(JSON.stringify({ pr: args.pr, headSha: pr.headSha, ...decision }));
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
      const state = codexState(pr.summaryBody, args.sha);
      if (state === 'completed' || state === 'failed') {
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
      'usage: codex-review.mjs request <PR番号> | codex-review.mjs wait <PR番号> --sha <head> [--interval 秒] [--timeout 秒]',
    );
    process.exit(2);
  }
  if (args.command === 'request') request(args);
  else await wait(args);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
