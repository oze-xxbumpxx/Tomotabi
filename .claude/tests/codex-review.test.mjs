// codex-review.mjsの「Codexのレビューの状態」「投稿するか」の判定と引数検査のテスト。ghは呼ばない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codexState, parseArgs, requestDecision } from '../scripts/codex-review.mjs';

const HEAD = '3141acad12f325db2012b60bd3615c633fbd8136';
const OLD = '1cc6c46ab83c7fbd0f3d5f3a716a60124d20a7fc';

const summary = (...rows) =>
  [
    '<!-- codex-pull-request-review-summary -->',
    '',
    '## Codex Review Summary',
    '',
    '| Review | Status | Commit | Review trigger |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
const row = (status, sha) => `| 📝 **Code Review** | ${status} | \`${sha.slice(0, 7)}\` | Comment |`;

test('CR-01: 今のheadの行がCompletedなら完了', () => {
  assert.equal(codexState(summary(row('✅ **Completed** <relative-time>x</relative-time>', HEAD)), HEAD), 'completed');
});

test('CR-02: 古いheadだけが完了なら、今のheadは未着手', () => {
  assert.equal(codexState(summary(row('✅ **Completed**', OLD)), HEAD), 'none');
});

test('CR-03: 今のheadの行が完了・失敗以外なら実行中、失敗なら失敗', () => {
  assert.equal(codexState(summary(row('⏳ **Running**', HEAD)), HEAD), 'running');
  assert.equal(codexState(summary(row('❌ **Failed**', HEAD)), HEAD), 'failed');
  // 失敗のあとに同じheadで完了した行があれば完了
  assert.equal(codexState(summary(row('❌ **Failed**', HEAD), row('✅ **Completed**', HEAD)), HEAD), 'completed');
});

test('CR-04: 要約コメントが無い・印が無いなら未着手', () => {
  assert.equal(codexState(null, HEAD), 'none');
  assert.equal(codexState('| 📝 **Code Review** | ✅ **Completed** | `3141aca` | x |', HEAD), 'none');
});

test('CR-05: 完了・実行中なら投稿しない', () => {
  const base = { headSha: HEAD, headCommittedAt: '2026-10-10T01:39:30Z', requests: [] };
  assert.deepEqual(requestDecision({ ...base, summaryBody: summary(row('✅ **Completed**', HEAD)) }), {
    action: 'skipped',
    reason: 'completed',
  });
  assert.equal(requestDecision({ ...base, summaryBody: summary(row('⏳ **Running**', HEAD)) }).reason, 'running');
});

test('CR-06: headより後に依頼があれば二重に投稿しない。headより前の依頼は数えない', () => {
  const base = { headSha: HEAD, headCommittedAt: '2026-10-10T01:39:30Z', summaryBody: summary(row('✅ **Completed**', OLD)) };
  const after = { body: '@codex review', createdAt: '2026-10-10T01:40:00Z' };
  const before = { body: '@codex review', createdAt: '2026-10-10T01:00:00Z' };
  assert.deepEqual(requestDecision({ ...base, requests: [after] }), { action: 'skipped', reason: 'requested' });
  assert.deepEqual(requestDecision({ ...base, requests: [before] }), { action: 'posted', reason: 'new' });
});

test('CR-07: 今のheadで失敗していたら、依頼済みでも頼み直す', () => {
  const r = requestDecision({
    headSha: HEAD,
    headCommittedAt: '2026-10-10T01:39:30Z',
    summaryBody: summary(row('❌ **Failed**', HEAD)),
    requests: [{ body: '@codex review', createdAt: '2026-10-10T01:40:00Z' }],
  });
  assert.deepEqual(r, { action: 'posted', reason: 'retry' });
});

test('CR-08: 引数の検査', () => {
  assert.deepEqual(parseArgs(['request', '183']), { command: 'request', pr: 183, sha: null, interval: 60, timeout: 3600 });
  assert.equal(parseArgs(['wait', '183']), null);
  assert.equal(parseArgs(['wait', '183', '--sha', HEAD]).sha, HEAD);
  assert.equal(parseArgs(['request', '183', '--sha', HEAD]), null);
  assert.equal(parseArgs(['review', '183']), null);
  assert.equal(parseArgs(['wait', '0', '--sha', HEAD]), null);
  assert.equal(parseArgs(['wait', '183', '--sha', 'XYZ']), null);
});
