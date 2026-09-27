#!/usr/bin/env node
// SessionStart Hook — 未レビューの「Issue に紐づかない Devin の PR」を一覧にして、レビューを促す（非ブロッキング）。
// 設計: docs/designs/devin-unlinked-pr-review.md
//
// 方針:
// - wait-for-devin-pr.mjs は委譲中のセッションでしか動かない。その取りこぼし（セッションの外で出た PR）の受け皿。
// - Hook はバックグラウンド処理もレビューも起動できないため、additionalContext で review-devin-pr を促すだけにする。
// - レビュー済みは、委譲の記録（Issue の記録の gh.pr / pr-<n>.yml）か、PR のコメントの <!-- claude-review の印で判断する。
// - gh が無い・未認証・遅い環境（クラウドのセッションなど）では何も出さない。失敗しても常に exit 0。

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DIR, readAllRecords } from '../scripts/delegation.mjs';
import { findUnlinkedDevinPrs, knownFromRecords, listOpenDevinPrs } from '../scripts/wait-for-devin-pr.mjs';

const GH_TIMEOUT_MS = 8_000;
export const REVIEW_MARKER = '<!-- claude-review';

/** @param {Array<{body?: string}>} comments */
export const hasReviewMarker = (comments) => (comments ?? []).some((c) => (c.body ?? '').includes(REVIEW_MARKER));

export function buildContext(prs) {
  return [
    '📌 Issue に紐づかない Devin の PR が、まだレビューされていません（知見・スキル・blueprint の PR など）。',
    ...prs.map((pr) => `- PR #${pr.number}（${pr.headRefName}）${pr.title ?? ''}`),
    'review-devin-pr スキルの「Issue なし PR」の手順でレビューする（先に `node .claude/scripts/delegation.mjs init pr-<番号>` で記録を作る）。',
    'ユーザーの今の依頼を優先し、区切りのよいところでレビューする。',
  ].join('\n');
}

function commentsOf(pr) {
  const out = execFileSync('gh', ['pr', 'view', String(pr), '--json', 'comments'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: GH_TIMEOUT_MS,
  });
  return JSON.parse(out).comments;
}

function main() {
  let pending;
  try {
    const known = knownFromRecords(readAllRecords(DEFAULT_DIR));
    pending = findUnlinkedDevinPrs(listOpenDevinPrs(null, GH_TIMEOUT_MS), known).filter((pr) => !hasReviewMarker(commentsOf(pr.number)));
  } catch {
    process.exit(0);
  }
  if (pending.length === 0) process.exit(0);
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: buildContext(pending) } }),
  );
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
