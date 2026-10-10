#!/usr/bin/env node
// PostToolUse(Bash) Hook — `gh issue create`の直後に、PRの待機と自動レビューを促す（非ブロッキング）。
//
// 方針:
// - Issueを他のエージェント（Devinなど）に渡したら、PRができた時点でClaude Codeがレビューする運用
//   （2026-09-26ユーザー依頼）を、セッションをまたいで忘れないようにする。
// - HookはClaudeのバックグラウンド処理を起動できないため、additionalContextで
//   wait-for-pr.mjsの起動とreview-devin-prスキルの使用を促すだけにする。
// - Issueに紐づかないDevinのPR（docs/designs/devin-unlinked-pr-review.md）を待つwait-for-devin-pr.mjsの起動も促す。
// - IssueのURLが出力に無いとき（作成失敗・--web等）は何もしない。失敗しても常にexit 0。

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
 * @returns {number[]} 作成されたIssue番号（重複なし・出現順）。対象外なら空配列。
 */
export function createdIssues(input) {
  const command = input?.tool_input?.command;
  if (typeof command !== 'string' || !/\bgh\s+issue\s+create\b/.test(command)) return [];
  const numbers = [...responseText(input.tool_response).matchAll(ISSUE_URL)].map((m) => Number(m[1]));
  return [...new Set(numbers)];
}

/** 秒までのISO 8601（ghのsearchのcreated:>= に渡す）。 */
const isoSeconds = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

export function buildContext(issues, now = new Date()) {
  const lines = issues.map((n) => `- Issue #${n}: 公開メタデータを照合し、\`node .claude/scripts/delegation.mjs import --request-file <公開JSON>\`で共通受付へ登録する。起動前に共有状態を確かめる。\`node .claude/scripts/wait-for-pr.mjs ${n}\`はPRの確認に使う`);
  return [
    '委譲は共通受付を使う。直接作ったIssueを起動許可にはしない。',
    ...lines,
    '承認済み計画のタスクはdelegation.mjs request --request-file <公開JSON>で登録し、delegation-launch.mjsでrunner/modelと非公開prompt fileを明示する。',
    `IssueなしPRは\`node .claude/scripts/wait-for-devin-pr.mjs --since ${isoSeconds(now)}\`で確認する。`,
    'このIssueを自分で実装する場合は、委譲の登録も待機もしない。',
    'PRが見つかったらreview-devin-prの手順で現在headの両レビューを照合する。unknownを自動再起動で解除しない。',
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
