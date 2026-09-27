#!/usr/bin/env node
// Issue に紐づかない Devin の PR（知見の PR など）ができるまで待つ。
// 設計: docs/designs/devin-unlinked-pr-review.md
//
// 使い方:
//   node .claude/scripts/wait-for-devin-pr.mjs --since <ISO 8601> [--interval 秒] [--timeout 秒]
//     既定: 60 秒ごとに確認し、8 時間で諦める。セッションで 1 本だけ run_in_background で起動する。
//
// 終了コード:
//   0 … 見つかった。見つかった PR ごとに {"pr","url","title","headRefName","author"} の JSON を 1 行ずつ出す
//   2 … 引数の誤り
//   3 … 時間切れ
//
// 方針:
// - 判定は findUnlinkedDevinPrs に閉じ込め、テストで固定する。
// - 「紐づく」は、委譲の記録がある Issue に wait-for-pr.mjs の規則で紐づくときだけ。
//   その PR は wait-for-pr.mjs が待っているので、ここでは拾わない（二重レビューを避ける）。
//   記録の無い Issue に紐づく PR は誰も待っていないので拾う。
//   ブランチ名の末尾 -N の規則だけで判定すると、devin/update-skills-1790414398 のような
//   時刻の数字を Issue 番号と誤読するため、記録のある番号に限る。
// - レビュー済みは委譲の記録（Issue の記録の gh.pr、または pr-<n>.yml）で判断する。
// - 取得の都度、記録を読み直す（待機中に init された記録を反映する）。

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DIR, readAllRecords } from './delegation.mjs';
import { findLinkedPr } from './wait-for-pr.mjs';

const DEFAULT_INTERVAL_SEC = 60;
const DEFAULT_TIMEOUT_SEC = 8 * 60 * 60;
const GH_TIMEOUT_MS = 30_000;
export const DEVIN_BRANCH_PREFIX = 'devin/';

/**
 * @param {Array<{number:number,headRefName?:string,createdAt?:string,title?:string,body?:string,
 *   closingIssuesReferences?:Array<{number:number}>}>} prs
 * @param {{since?: string | null, delegatedIssues?: number[], reviewedPrs?: number[]}} options
 *   since より前に作られた PR は対象外（null なら絞らない）。
 * @returns {Array<object>} 対象の PR を番号の昇順で。
 */
export function findUnlinkedDevinPrs(prs, { since = null, delegatedIssues = [], reviewedPrs = [] } = {}) {
  const sinceMs = since === null ? null : Date.parse(since);
  const reviewed = new Set(reviewedPrs);
  return prs
    .filter((pr) => (pr.headRefName ?? '').startsWith(DEVIN_BRANCH_PREFIX))
    .filter((pr) => sinceMs === null || Date.parse(pr.createdAt ?? '') >= sinceMs)
    .filter((pr) => !reviewed.has(pr.number))
    .filter((pr) => !delegatedIssues.some((issue) => findLinkedPr([pr], issue) !== null))
    .sort((a, b) => a.number - b.number);
}

/** 記録から「委譲した Issue」と「レビュー済みの PR」を取り出す。 */
export function knownFromRecords(records) {
  const delegatedIssues = [];
  const reviewedPrs = [];
  for (const rec of records) {
    if (Number.isInteger(rec.issue)) delegatedIssues.push(rec.issue);
    if (Number.isInteger(rec.pr)) reviewedPrs.push(rec.pr);
    if (Number.isInteger(rec.gh?.pr)) reviewedPrs.push(rec.gh.pr);
  }
  return { delegatedIssues, reviewedPrs };
}

export const toOutputLine = (pr) =>
  JSON.stringify({
    pr: pr.number,
    url: pr.url,
    title: pr.title,
    headRefName: pr.headRefName,
    author: pr.author?.login ?? null,
  });

/** OPEN の Devin の PR。since を渡すと作成日時で絞る。 */
export function listOpenDevinPrs(since = null, timeout = GH_TIMEOUT_MS) {
  const args = ['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,title,body,headRefName,url,createdAt,closingIssuesReferences,author'];
  if (since !== null) args.push('--search', `created:>=${since}`);
  const out = execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout });
  return JSON.parse(out).filter((pr) => (pr.headRefName ?? '').startsWith(DEVIN_BRANCH_PREFIX));
}

export function parseArgs(argv) {
  let since = null;
  let interval = DEFAULT_INTERVAL_SEC;
  let timeout = DEFAULT_TIMEOUT_SEC;
  for (let i = 0; i < argv.length; i += 2) {
    const value = argv[i + 1];
    if (value === undefined) return null;
    if (argv[i] === '--since') {
      if (Number.isNaN(Date.parse(value))) return null;
      since = value;
      continue;
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (argv[i] === '--interval') interval = n;
    else if (argv[i] === '--timeout') timeout = n;
    else return null;
  }
  if (since === null) return null;
  return { since, interval, timeout };
}

const sleep = (sec) => new Promise((resolve) => setTimeout(resolve, sec * 1000));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error('usage: wait-for-devin-pr.mjs --since <ISO 8601> [--interval 秒] [--timeout 秒]');
    process.exit(2);
  }
  const deadline = Date.now() + args.timeout * 1000;
  console.log(`${args.since} 以降に作られた、Issue に紐づかない Devin の PR を待っています（${args.interval} 秒ごと）`);
  for (;;) {
    try {
      const found = findUnlinkedDevinPrs(listOpenDevinPrs(args.since), {
        since: args.since,
        ...knownFromRecords(readAllRecords(DEFAULT_DIR)),
      });
      if (found.length > 0) {
        console.log(`Issue に紐づかない Devin の PR が見つかりました: ${found.map((pr) => `#${pr.number}`).join(' ')}`);
        for (const pr of found) console.log(toOutputLine(pr));
        process.exit(0);
      }
    } catch (error) {
      console.error(`確認に失敗しました（次の周期で再試行）: ${error.message.split('\n')[0]}`);
    }
    if (Date.now() + args.interval * 1000 > deadline) {
      console.log('時間切れ: Issue に紐づかない Devin の PR は見つかりませんでした');
      process.exit(3);
    }
    await sleep(args.interval);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
