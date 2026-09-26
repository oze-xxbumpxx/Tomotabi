#!/usr/bin/env node
// Issue に紐づく PR ができるまで待つ（Devin など他のエージェントに渡した Issue の自動レビュー用）。
//
// 使い方:
//   node .claude/scripts/wait-for-pr.mjs <issue番号> [--interval 秒] [--timeout 秒]
//     既定: 60 秒ごとに確認し、8 時間で諦める。
//   Claude Code からは Bash の run_in_background で起動する。終了するとセッションが呼び戻される。
//
// 終了コード:
//   0 … 見つかった。標準出力の最後の行に {"issue","number","url","title","headRefName"} を出す
//   2 … 引数の誤り
//   3 … 時間切れ
//
// 方針:
// - 「紐づく」の判定は findLinkedPr に閉じ込め、テストで固定する。
//   PR 本文の Closes / Fixes / Resolves #N、または「Issue #N」、またはブランチ名の末尾 -N。
//   Devin は本文に Closes を書き忘れることがあった（#33）ため、Issue #N とブランチ名も見る。
// - gh の一時的な失敗（ネットワーク等）では止めず、次の周期で再試行する。

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_INTERVAL_SEC = 60;
const DEFAULT_TIMEOUT_SEC = 8 * 60 * 60;

/**
 * @param {Array<{number:number,title?:string,body?:string,headRefName?:string,url?:string}>} prs
 * @param {number} issue
 * @returns {object | null} 紐づく PR のうち番号が最小のもの。無ければ null。
 */
export function findLinkedPr(prs, issue) {
  const n = String(issue);
  const bodyLink = new RegExp(`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#${n}(?!\\d)`, 'i');
  const issueMention = new RegExp(`\\bissue\\s*#${n}(?!\\d)`, 'i');
  const branchSuffix = new RegExp(`[-/]${n}$`);
  const linked = prs.filter((pr) => {
    const text = `${pr.title ?? ''}\n${pr.body ?? ''}`;
    return bodyLink.test(text) || issueMention.test(text) || branchSuffix.test(pr.headRefName ?? '');
  });
  if (linked.length === 0) return null;
  return linked.sort((a, b) => a.number - b.number)[0];
}

function parseArgs(argv) {
  const [issueArg, ...rest] = argv;
  const issue = Number(issueArg);
  if (!Number.isInteger(issue) || issue <= 0) return null;
  let interval = DEFAULT_INTERVAL_SEC;
  let timeout = DEFAULT_TIMEOUT_SEC;
  for (let i = 0; i < rest.length; i += 2) {
    const value = Number(rest[i + 1]);
    if (!Number.isFinite(value) || value <= 0) return null;
    if (rest[i] === '--interval') interval = value;
    else if (rest[i] === '--timeout') timeout = value;
    else return null;
  }
  return { issue, interval, timeout };
}

function listPrs() {
  const out = execFileSync(
    'gh',
    ['pr', 'list', '--state', 'all', '--limit', '50', '--json', 'number,title,body,headRefName,url'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return JSON.parse(out);
}

const sleep = (sec) => new Promise((resolve) => setTimeout(resolve, sec * 1000));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error('usage: wait-for-pr.mjs <issue番号> [--interval 秒] [--timeout 秒]');
    process.exit(2);
  }
  const deadline = Date.now() + args.timeout * 1000;
  console.log(`Issue #${args.issue} に紐づく PR を待っています（${args.interval} 秒ごと）`);
  for (;;) {
    try {
      const pr = findLinkedPr(listPrs(), args.issue);
      if (pr !== null) {
        console.log(`PR #${pr.number} が見つかりました: ${pr.url}`);
        console.log(JSON.stringify({ issue: args.issue, number: pr.number, url: pr.url, title: pr.title, headRefName: pr.headRefName }));
        process.exit(0);
      }
    } catch (error) {
      console.error(`gh の確認に失敗しました（次の周期で再試行）: ${error.message.split('\n')[0]}`);
    }
    if (Date.now() + args.interval * 1000 > deadline) {
      console.log(`時間切れ: Issue #${args.issue} に紐づく PR は見つかりませんでした`);
      process.exit(3);
    }
    await sleep(args.interval);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
