#!/usr/bin/env node
// SessionStart Hook — 未レビューの「Issue に紐づかない Devin の PR」を一覧にして、レビューを促す（非ブロッキング）。
// 設計: docs/designs/devin-unlinked-pr-review.md
//
// 方針:
// - wait-for-devin-pr.mjs は委譲中のセッションでしか動かない。その取りこぼし（セッションの外で出た PR）の受け皿。
// - Hook はバックグラウンド処理もレビューも起動できないため、additionalContext で review-devin-pr を促すだけにする。
// - レビュー済みは、委譲の記録（Issue の記録の gh.pr / reviews のある pr-<n>.yml）か、PR のコメントの <!-- claude-review の印で判断する。
// - コメントの取得に失敗した PR は捨てず、「未確認」として出す（1 件の失敗で他の PR を隠さない）。
// - gh が無い・未認証・遅い環境（クラウドのセッションなど）では何も出さない。失敗しても常に exit 0。

import { fileURLToPath } from 'node:url';
import { DEFAULT_DIR, readAllRecords } from '../scripts/delegation.mjs';
import { filterUnreviewed, findUnlinkedDevinPrs, knownFromRecords, listOpenDevinPrs, prComments } from '../scripts/wait-for-devin-pr.mjs';

const GH_TIMEOUT_MS = 8_000;

const line = (pr, note = '') => `- PR #${pr.number}（${pr.headRefName}）${pr.title ?? ''}${note}`;

/** unchecked はコメントを取得できず、レビュー済みかを確かめられなかった PR（捨てずに出す）。 */
export function buildContext(pending, unchecked = []) {
  return [
    '📌 Issue に紐づかない Devin の PR が、まだレビューされていません（知見・スキル・blueprint の PR など）。',
    ...pending.map((pr) => line(pr)),
    ...unchecked.map((pr) => line(pr, ' ※コメントを取得できず、レビュー済みかは未確認')),
    'review-devin-pr スキルの「Issue なし PR」の手順でレビューする（`pr-<番号>.yml` が無ければ `node .claude/scripts/delegation.mjs init pr-<番号>` で作る。あれば中断したレビューなので、その記録で続ける）。',
    'ユーザーの今の依頼を優先し、区切りのよいところでレビューする。',
  ].join('\n');
}

function main() {
  let result;
  try {
    const known = knownFromRecords(readAllRecords(DEFAULT_DIR));
    const candidates = findUnlinkedDevinPrs(listOpenDevinPrs(null, GH_TIMEOUT_MS), known);
    result = filterUnreviewed(candidates, (n) => prComments(n, GH_TIMEOUT_MS));
  } catch {
    process.exit(0);
  }
  if (result.pending.length === 0 && result.unchecked.length === 0) process.exit(0);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: buildContext(result.pending, result.unchecked) },
    }),
  );
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
