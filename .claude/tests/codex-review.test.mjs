// codex-review.mjsの「Codexのレビューの状態」「投稿するか」の判定と引数検査のテスト。ghは呼ばない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codexState, parseArgs, requestBody, requestDecision, waitOutcome } from '../scripts/codex-review.mjs';

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
  const base = { headSha: HEAD, viewer: 'me', requests: [] };
  assert.deepEqual(requestDecision({ ...base, summaryBody: summary(row('✅ **Completed**', HEAD)) }), {
    action: 'skipped',
    reason: 'completed',
  });
  assert.equal(requestDecision({ ...base, summaryBody: summary(row('⏳ **Running**', HEAD)) }).reason, 'running');
});

test('CR-06: 自分が今のheadの印を付けた依頼だけを依頼済みと数える', () => {
  const base = { headSha: HEAD, viewer: 'me', summaryBody: summary(row('✅ **Completed**', OLD)) };
  const mine = { body: requestBody(HEAD), author: 'me' };
  assert.deepEqual(requestDecision({ ...base, requests: [mine] }), { action: 'skipped', reason: 'requested' });
  // 古いheadへの依頼（日時がどうであれ）は数えない
  assert.equal(requestDecision({ ...base, requests: [{ body: requestBody(OLD), author: 'me' }] }).action, 'posted');
  // 印の無い依頼・ほかの人の依頼は数えない（権限の無い人にはCodexが反応しない）
  assert.equal(requestDecision({ ...base, requests: [{ body: '@codex review', author: 'me' }] }).action, 'posted');
  assert.equal(requestDecision({ ...base, requests: [{ body: requestBody(HEAD), author: 'someone' }] }).action, 'posted');
});

test('CR-07: 今のheadで失敗していたら、依頼済みでも頼み直す', () => {
  const r = requestDecision({
    headSha: HEAD,
    viewer: 'me',
    summaryBody: summary(row('❌ **Failed**', HEAD)),
    requests: [{ body: requestBody(HEAD), author: 'me' }],
  });
  assert.deepEqual(r, { action: 'posted', reason: 'retry' });
});

test('CR-09: 頼み直したあとは、要約コメントが依頼より後に更新されるまで前の失敗で終えない', () => {
  const failed = summary(row('❌ **Failed**', HEAD));
  const since = '2026-10-10T02:00:00Z';
  assert.equal(waitOutcome({ summaryBody: failed, summaryUpdatedAt: '2026-10-10T01:50:00Z', headSha: HEAD, since }), 'waiting');
  assert.equal(waitOutcome({ summaryBody: failed, summaryUpdatedAt: '2026-10-10T02:05:00Z', headSha: HEAD, since }), 'failed');
  assert.equal(waitOutcome({ summaryBody: failed, summaryUpdatedAt: '2026-10-10T01:50:00Z', headSha: HEAD }), 'failed');
  assert.equal(
    waitOutcome({ summaryBody: summary(row('✅ **Completed**', HEAD)), summaryUpdatedAt: null, headSha: HEAD, since }),
    'completed',
  );
  assert.equal(waitOutcome({ summaryBody: null, summaryUpdatedAt: null, headSha: HEAD, since }), 'waiting');
});

test('CR-10: 依頼の本文は@codex reviewで始まり、対象のheadの印を持つ', () => {
  assert.match(requestBody(HEAD), /^@codex review\n\n<!-- tomotabi-codex-request head=3141acad12f325db2012b60bd3615c633fbd8136 -->$/);
});

test('CR-08: 引数の検査', () => {
  assert.deepEqual(parseArgs(['request', '183']), { command: 'request', pr: 183, sha: null, since: null, interval: 60, timeout: 3600 });
  assert.equal(parseArgs(['wait', '183']), null);
  assert.equal(parseArgs(['wait', '183', '--sha', HEAD]).sha, HEAD);
  assert.equal(parseArgs(['request', '183', '--sha', HEAD]), null);
  assert.equal(parseArgs(['review', '183']), null);
  assert.equal(parseArgs(['wait', '0', '--sha', HEAD]), null);
  assert.equal(parseArgs(['wait', '183', '--sha', 'XYZ']), null);
  assert.equal(parseArgs(['wait', '183', '--sha', HEAD, '--since', '2026-10-10T02:00:00Z']).since, '2026-10-10T02:00:00Z');
  assert.equal(parseArgs(['wait', '183', '--sha', HEAD, '--since', 'x']), null);
});
