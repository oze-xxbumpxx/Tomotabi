// wait-for-devin-pr.mjs の「Issue に紐づかない Devin の PR」の判定と引数検査のテスト。gh は呼ばない。
// 観点 ID は docs/tests/devin-unlinked-pr-review.md。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findUnlinkedDevinPrs, knownFromRecords, parseArgs, toOutputLine } from '../scripts/wait-for-devin-pr.mjs';

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), '../scripts/wait-for-devin-pr.mjs');

const pr = (number, headRefName, extra = {}) => ({ number, headRefName, body: '', createdAt: '2026-09-26T09:20:00Z', ...extra });
const numbers = (prs) => prs.map((p) => p.number);

test('U-01: devin/ 以外のブランチの PR は対象外', () => {
  const prs = [pr(60, 'claude/m1-manual-check'), pr(49, 'docs/design-handoff-v3'), pr(54, 'devin/update-blueprint-1790414400')];
  assert.deepEqual(numbers(findUnlinkedDevinPrs(prs)), [54]);
});

test('U-02: 委譲の記録がある Issue に紐づく PR は対象外（本文・closingIssuesReferences・ブランチ名の末尾）', () => {
  const prs = [
    pr(56, 'devin/auth-error-redirect-55'),
    pr(52, 'devin/m1-d-web-auth', { body: 'Closes #51' }),
    pr(39, 'devin/m1-b4-better-auth', { closingIssuesReferences: [{ number: 37 }] }),
  ];
  assert.deepEqual(findUnlinkedDevinPrs(prs, { delegatedIssues: [55, 51, 37] }), []);
});

test('U-03: 末尾が数字でも、記録の無い番号なら Issue の紐づけとみなさない（#53・#54 のブランチ）', () => {
  const prs = [pr(53, 'devin/update-skills-1790414398'), pr(54, 'devin/update-blueprint-1790414400')];
  assert.deepEqual(numbers(findUnlinkedDevinPrs(prs, { delegatedIssues: [51, 55] })), [53, 54]);
});

test('U-04: 記録の無い Issue に紐づく PR は、誰も待っていないので対象', () => {
  const prs = [pr(36, 'devin/pr-template', { body: 'Closes #99' })];
  assert.deepEqual(numbers(findUnlinkedDevinPrs(prs, { delegatedIssues: [51] })), [36]);
});

test('U-05: since より前に作られた PR は対象外', () => {
  const prs = [pr(53, 'devin/a', { createdAt: '2026-09-26T09:19:59Z' }), pr(54, 'devin/b', { createdAt: '2026-09-26T09:20:00Z' })];
  assert.deepEqual(numbers(findUnlinkedDevinPrs(prs, { since: '2026-09-26T09:20:00Z' })), [54]);
});

test('U-06: レビュー済み（記録がある）PR は対象外。複数あれば番号順ですべて返す', () => {
  const prs = [pr(70, 'devin/c'), pr(54, 'devin/b'), pr(53, 'devin/a')];
  assert.deepEqual(numbers(findUnlinkedDevinPrs(prs, { reviewedPrs: [54] })), [53, 70]);
});

test('U-07: 記録から委譲した Issue とレビュー済みの PR を取り出す', () => {
  const records = [
    { issue: 55, gh: { pr: 56 } },
    { issue: 51, gh: null },
    { issue: null, pr: 53, origin: 'self', gh: null },
  ];
  assert.deepEqual(knownFromRecords(records), { delegatedIssues: [55, 51], reviewedPrs: [56, 53] });
});

test('U-08: 出力の JSON 行', () => {
  const line = toOutputLine({ ...pr(53, 'devin/a'), url: 'https://example.test/53', title: 't', author: { login: 'app/devin-ai-integration' } });
  assert.deepEqual(JSON.parse(line), { pr: 53, url: 'https://example.test/53', title: 't', headRefName: 'devin/a', author: 'app/devin-ai-integration' });
});

test('U-09: 引数の検査（--since は必須で ISO 8601）', () => {
  assert.deepEqual(parseArgs(['--since', '2026-09-26T09:20:00Z']), { since: '2026-09-26T09:20:00Z', interval: 60, timeout: 28800 });
  assert.deepEqual(parseArgs(['--since', '2026-09-26T09:20:00Z', '--interval', '5', '--timeout', '10']).interval, 5);
  assert.equal(parseArgs([]), null);
  assert.equal(parseArgs(['--since', 'yesterday']), null);
  assert.equal(parseArgs(['--since', '2026-09-26T09:20:00Z', '--interval', '0']), null);
  assert.equal(parseArgs(['--since', '2026-09-26T09:20:00Z', '--foo', '1']), null);
  const res = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });
  assert.equal(res.status, 2);
});
