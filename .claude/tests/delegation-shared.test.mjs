import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DelegationError, REQUEST_MARKER, EVENT_MARKER, ANCHOR_MARKER, TASK_MARKER, ZERO_HASH,
  canonicalJson, hashJson, taskDigest, validateRequest, parseRequestComment, formatRequestComment,
  formatAnchor, extractPlanTask, emptyState, applyChanges, createJournalEvent, verifyJournal, reduceRequest, newRequestId,
} from '../scripts/delegation-shared.mjs';

const ID = '11111111-1111-4111-8111-111111111111';
const CALLER = '22222222-2222-4222-8222-222222222222';
const ATTEMPT = '33333333-3333-4333-8333-333333333333';
const ACT = '44444444-4444-4444-8444-444444444444';
const config = { migration_complete: true, cli_launch_verified: true, limits: { tasks: 100 } };
const now = '2026-10-09T10:00:00Z';
const context = { config, now, attempt_id: ATTEMPT, plan_verified: true, issue_verified: true };
const base = (operation, fields = {}) => ({ schema_version: 1, request_id: ID, operation, ...fields });
const register = () => base('register', { task_key: 'feature:task', plan_path: 'docs/implementation-plans/feature.md', plan_sha: 'a'.repeat(40), task_digest: 'b'.repeat(64), start_conditions_confirmed: true });
const pointer = { schema_version: 1, last_seq: 0, last_event_id: null, last_hash: ZERO_HASH };

test('必須値・版・UUID・長さと公開欄を検証し、専用印の単独JSONだけを読む', () => {
  assert.deepEqual(parseRequestComment(formatRequestComment(register())), register());
  assert.equal(parseRequestComment(`> ${formatRequestComment(register())}`), null);
  assert.equal(parseRequestComment(`\`\`\`\n${formatRequestComment(register())}\n\`\`\``), null);
  for (const request of [{ ...register(), schema_version: 2 }, { ...register(), request_id: '' }, { ...register(), task_key: 'X:task' }, { ...register(), plan_sha: 'abc' }, { ...register(), raw_prompt: 'SECRET' }, { ...register(), plan_path: '../../script.sh' }, { ...register(), task_digest: 'a' }, { ...register(), start_conditions_confirmed: 'yes' }]) assert.throws(() => validateRequest(request), DelegationError);
  assert.throws(() => parseRequestComment(`${REQUEST_MARKER}\n{}\n{}`), /invalid_json/);
  assert.throws(() => validateRequest(register(), { maxBytes: 1 }), /request_limit/);
  assert.match(newRequestId(), /^[0-9a-f-]{36}$/);
  assert.equal(validateRequest({ ...register(), task_key: `${'a'.repeat(64)}:${'b'.repeat(64)}`, plan_path: `docs/implementation-plans/${'a'.repeat(64)}.md` }).task_key.length, 129);
  assert.throws(() => validateRequest({ ...register(), task_key: `${'a'.repeat(65)}:task` }), /invalid_task_key/);
});

test('再帰キー順と整数を固定し、波の外のタスク本文をLFでhashにする', () => {
  assert.equal(canonicalJson({ z: 1, a: { z: [2, 1], b: null } }), '{"a":{"b":null,"z":[2,1]},"z":1}');
  assert.equal(hashJson({ b: 2, a: 1 }), hashJson({ a: 1, b: 2 }));
  for (const value of [NaN, Infinity, 1.5, undefined]) assert.throws(() => canonicalJson(value), DelegationError);
  assert.throws(() => canonicalJson(JSON.parse('{"__proto__":{}}')), /invalid_json_key/);
  const block = '<!-- delegation-task:task -->\r\nやること\r\n<!-- /delegation-task -->';
  assert.deepEqual(extractPlanTask(`wave 1\n${block}`, 'feature:task'), extractPlanTask(`wave 2\n${block}`, 'feature:task'));
  assert.equal(extractPlanTask(block, 'feature:task').task_digest, taskDigest('やること'));
  assert.throws(() => extractPlanTask(`${block}\n${block}`, 'feature:task'), /plan_task_conflict/);
  assert.throws(() => extractPlanTask('empty', 'feature:task'), DelegationError);
});

test('初回registerはregisteredとなり、同task/別digest/取り下げ/移行前/101件を区別する', () => {
  const reduced = reduceRequest(Object.freeze(emptyState()), register(), context);
  const state = applyChanges(emptyState(), reduced.changes);
  assert.equal(state.tasks['feature:task'].state, 'registered');
  assert.equal(state.tasks['feature:task'].start_conditions_confirmed, true);
  assert.equal(emptyState().seq, 0);
  assert.equal(reduceRequest(state, { ...register(), wave: '2' }, context).result.code, 'already_registered');
  assert.throws(() => reduceRequest(state, { ...register(), task_digest: 'c'.repeat(64) }, context), /content_conflict/);
  state.tasks['feature:task'].state = 'withdrawn';
  assert.throws(() => reduceRequest(state, register(), context), /content_conflict/);
  assert.throws(() => reduceRequest(emptyState(), register(), { ...context, config: { migration_complete: false } }), /migration_pending/);
  const full = emptyState();
  for (let n = 0; n < 100; n += 1) full.tasks[`other:t${n}`] = {};
  assert.throws(() => reduceRequest(full, register(), context), /task_limit/);
  assert.throws(() => reduceRequest(emptyState(), register(), { ...context, plan_verified: false }), /plan_unverified/);
});

test('差分journalと先頭位置を照合し、連続末尾だけを回復する', () => {
  const reduced = reduceRequest(emptyState(), register(), context);
  const meta = { source_run_id: 1, source_run_attempt: 1, request_id: ID, request_comment_id: 12, request_hash: hashJson(register()), operation: 'register' };
  const event = createJournalEvent(emptyState(), reduced.changes, meta, reduced.result);
  const recovery = verifyJournal([{ event, comment_id: 13 }], pointer);
  assert.equal(recovery.recovery, true);
  assert.equal(recovery.tasks['feature:task'].updated_seq, 1);
  assert.deepEqual(JSON.parse(formatAnchor(recovery.recovered_pointer).slice(ANCHOR_MARKER.length + 1)), recovery.recovered_pointer);
  assert.equal(verifyJournal([{ event, comment_id: 13 }], recovery.recovered_pointer).recovery, false);
  assert.throws(() => verifyJournal([{ event: { ...event, seq: 2 }, comment_id: 13 }], pointer), /journal_corrupt/);
  assert.throws(() => verifyJournal([{ event, comment_id: 13 }, { event, comment_id: 14 }], pointer), /journal_corrupt/);
  assert.throws(() => verifyJournal([], recovery.recovered_pointer), DelegationError);
  assert.throws(() => verifyJournal([{ event, comment_id: 13 }], { ...recovery.recovered_pointer, last_hash: ZERO_HASH }), /anchor_mismatch/);
  assert.throws(() => createJournalEvent(emptyState(), reduced.changes, meta, reduced.result, { maxBytes: 20 }), /event_limit/);
  assert.equal(EVENT_MARKER.includes('event'), true);
  assert.equal(TASK_MARKER.includes('task'), true);
});

test('requestの再配送は内容を照合し、begin許可を再発行しない', () => {
  const request = base('begin', { attempt_id: ATTEMPT, caller_id: CALLER, activation_id: ACT });
  const state = { ...emptyState(), requests: { [ID]: { request_hash: hashJson(request), result: { code: 'begin_allowed', allowed: true } } } };
  assert.deepEqual(reduceRequest(state, request, context).result, { code: 'already_begun', allowed: false, first_delivery: false });
  assert.equal(reduceRequest(state, { ...request, activation_id: CALLER }, context).result.code, 'request_conflict');
});

function ready() {
  const state = applyChanges(emptyState(), reduceRequest(emptyState(), register(), context).changes);
  state.tasks['feature:task'] = { ...state.tasks['feature:task'], state: 'issue_ready', issue: 10 };
  return state;
}

test('claimとbeginは担当を確保し、同callerと別activationの再送を区別する', () => {
  const claim = base('claim', { task_key: 'feature:task', task_digest: 'b'.repeat(64), caller_id: CALLER, runner: 'cloud', requested_model: 'swe-2-high' });
  let state = ready();
  const claimed = reduceRequest(state, claim, context);
  assert.equal(claimed.result.attempt_id, ATTEMPT);
  state = applyChanges(state, claimed.changes);
  assert.equal(reduceRequest(state, claim, context).result.code, 'already_reserved');
  assert.throws(() => reduceRequest(state, { ...claim, caller_id: ACT }, context), /claim_unavailable/);
  assert.throws(() => reduceRequest(ready(), claim, { ...context, issue_verified: false }), /claim_unavailable/);
  assert.throws(() => reduceRequest(ready(), claim, { ...context, config: { ...config, cli_launch_verified: false } }), /launch_unverified/);
  const begin = base('begin', { task_key: 'feature:task', attempt_id: ATTEMPT, caller_id: CALLER, activation_id: ACT });
  const begun = reduceRequest(state, begin, context);
  assert.deepEqual([begun.result.allowed, begun.result.first_delivery, begun.result.code], [true, true, 'begin_allowed']);
  state = applyChanges(state, begun.changes);
  assert.equal(reduceRequest(state, { ...begin, activation_id: ID }, context).result.allowed, false);
  assert.throws(() => reduceRequest(state, { ...begin, caller_id: ID }, context), /unauthorized_attempt/);
});

test('同callerの予約再利用でもrunner/modelは予約済み設定と一致する', () => {
  const claim = base('claim', { task_key: 'feature:task', task_digest: 'b'.repeat(64), caller_id: CALLER, runner: 'local', requested_model: 'swe-2-high' });
  const state = applyChanges(ready(), reduceRequest(ready(), claim, context).changes);
  const original = canonicalJson(state);
  for (const change of [{ runner: 'cloud' }, { requested_model: 'swe-2-medium' }, { runner: 'cloud', requested_model: 'swe-2-medium' }]) {
    assert.throws(() => reduceRequest(state, { ...claim, ...change, request_id: newRequestId() }, context), /configuration_conflict/);
    assert.equal(canonicalJson(state), original);
  }
  assert.equal(reduceRequest(state, { ...claim, request_id: newRequestId() }, context).result.code, 'already_reserved');
});
test('期限の境界とstartedはunknownで停止し、確認済みsessionだけrunningになる', () => {
  const state = ready();
  state.tasks['feature:task'] = { ...state.tasks['feature:task'], state: 'reserved', attempt_id: ATTEMPT, caller_id: CALLER, reserved_at: now };
  const begin = base('begin', { attempt_id: ATTEMPT, caller_id: CALLER, activation_id: ACT });
  assert.equal(reduceRequest(state, begin, { ...context, now: '2026-10-09T10:14:59.999Z' }).result.allowed, true);
  assert.equal(reduceRequest(state, begin, { ...context, now: '2026-10-09T10:15:00Z' }).result.code, 'launch_unknown');
  const launching = applyChanges(state, reduceRequest(state, begin, context).changes);
  const started = base('started', { task_key: 'feature:task', attempt_id: ATTEMPT, caller_id: CALLER, activation_id: ACT, session_id: null, session_url: null, observed_model: 'unknown' });
  assert.equal(reduceRequest(launching, started, context).result.code, 'launch_unknown');
  const known = { ...started, session_id: 'session123', session_url: 'https://app.devin.ai/sessions/session123', observed_model: 'unknown' };
  assert.equal(reduceRequest(launching, { ...known, session_url: null }, { ...context, session_verified: true }).result.code, 'launch_unknown');
  assert.equal(reduceRequest(launching, { ...known, session_url: 'https://app.devin.ai/sessions/another' }, { ...context, session_verified: true }).result.code, 'launch_unknown');
  assert.equal(reduceRequest(launching, known, { ...context, session_verified: true }).changes.tasks['feature:task'].state, 'running');
  const expired = reduceRequest(state, base('reconcile', { task_key: 'feature:task' }), { ...context, now: '2026-10-09T10:15:00Z' });
  assert.equal(expired.changes.tasks['feature:task'].attempt_id, ATTEMPT);
  assert.throws(() => reduceRequest(state, begin, { ...context, now: 'invalid' }), /invalid_time/);
});

test('import/link-pr/review-refreshは照合結果を必要とし、公開以外の欄は保存しない', () => {
  const imported = base('import', { task_key: 'feature:task', task_digest: 'b'.repeat(64), issue: 10, start_conditions_confirmed: true });
  const result = reduceRequest(emptyState(), imported, { ...context, import_verified: true });
  assert.equal(result.result.code, 'imported');
  assert.equal(result.changes.tasks['feature:task'].state, 'launch_unknown');
  assert.throws(() => reduceRequest(emptyState(), imported, context), /import_unverified/);
  const link = base('link-pr', { task_key: 'feature:task', pr: 12 });
  const linked = reduceRequest(ready(), link, { ...context, link_verified: true, pr_state: 'OPEN', head_sha: 'c'.repeat(40) });
  assert.equal(linked.changes.prs[12].target, true);
  assert.equal(linked.changes.tasks['feature:task'].state, 'pr_open');
  assert.equal(reduceRequest(emptyState(), base('review-refresh', { pr: 12 }), context).result.code, 'review_pending');
  assert.throws(() => applyChanges(emptyState(), { tasks: { 'feature:task': { task_key: 'feature:task', state: 'running', raw_prompt: 'SECRET' } } }), /invalid_event_task/);
  const error = new DelegationError('content_conflict');
  assert.equal(error.exit_code, 2);
});
