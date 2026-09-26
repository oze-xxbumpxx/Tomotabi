#!/usr/bin/env node
// PostToolUse(Bash) Hook — `gh issue create` の直後に、PR の待機と自動レビューを促す（非ブロッキング）。
//
// 方針:
// - Issue を他のエージェント（Devin など）に渡したら、PR ができた時点で Claude Code がレビューする運用
//   （2026-09-26 ユーザー依頼）を、セッションをまたいで忘れないようにする。
// - Hook は Claude のバックグラウンド処理を起動できないため、additionalContext で
//   wait-for-pr.mjs の起動と review-devin-pr スキルの使用を促すだけにする。
// - Issue の URL が出力に無いとき（作成失敗・--web 等）は何もしない。失敗しても常に exit 0。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ISSUE_URL = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/(\d+)/g;

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function responseText(response) {
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object') {
    return [response.stdout, response.output, response.stderr]
      .filter((v) => typeof v === 'string')
      .join('\n');
  }
  return '';
}

/**
 * @returns {number[]} 作成された Issue 番号（重複なし・出現順）。対象外なら空配列。
 */
export function createdIssues(input) {
  const command = input?.tool_input?.command;
  if (typeof command !== 'string' || !/\bgh\s+issue\s+create\b/.test(command)) return [];
  const numbers = [...responseText(input.tool_response).matchAll(ISSUE_URL)].map((m) => Number(m[1]));
  return [...new Set(numbers)];
}

export function buildContext(issues) {
  const lines = issues.map(
    (n) =>
      `- Issue #${n}: \`node .claude/scripts/delegation.mjs init ${n} --model <swe-2-medium|swe-2-high|swe-2-max> [--runner cloud]\` で記録を作り（既定はローカル実行）、` +
      `Bash の run_in_background で \`node .claude/scripts/wait-for-pr.mjs ${n}\` を起動する`,
  );
  return [
    '📌 Issue を作成しました。この Issue を他のエージェント（Devin など）に渡す場合は、PR を待って自動レビューします。',
    ...lines,
    '終了して呼び戻されたら review-devin-pr スキルの手順でレビューする。',
    'この Issue を自分（Claude Code）で実装する場合は待機しない。',
  ].join('\n');
}

function main() {
  let input = {};
  try {
    input = JSON.parse(readStdin() || '{}');
  } catch {
    process.exit(0);
  }
  const issues = createdIssues(input);
  if (issues.length === 0) process.exit(0);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: buildContext(issues) },
    }),
  );
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
