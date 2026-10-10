import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  REQUEST_MARKER, EVENT_MARKER, ANCHOR_MARKER, TASK_MARKER, ZERO_HASH, taskDigest, formatAnchor,
  readSnapshot, readIssueComments, submitRequest, waitForResult, verifyControlRun, verifyMainCommit,
} from '../scripts/delegation-shared.mjs';
import { runController, persistEvent, verifyPlan, findCreatedIssue, refreshSha, initializeAnchor, decodeNotificationZip } from '../scripts/delegation-control.mjs';
import { createGitHubClient } from '../scripts/delegation-github.mjs';

const REPO = 'oze-xxbumpxx/Tomotabi';
const SHA = 'a'.repeat(40);
const NOW = '2026-10-09T10:00:00Z';
const AUTHOR = 109064833;
const ACTIONS = 41898282;
const config = {
  schema_version: 1, repository: REPO, repository_id: 1359576461, default_branch: 'main', management_issue: 1, anchor_comment_id: 1,
  controller_workflow_id: 12, controller_workflow_path: '.github/workflows/delegation-control.yml', listener_workflow_id: 13, listener_workflow_path: '.github/workflows/delegation-events.yml',
  allowed_controller_events: ['issue_comment', 'workflow_dispatch', 'schedule', 'workflow_run'], actor_ids: { request: [AUTHOR], actions: ACTIONS, claude: [AUTHOR], codex: 199175422, devin: 158243242 },
  migration_complete: true, cli_launch_verified: true,
  limits: { request_bytes: 8192, event_bytes: 49152, comments: 1000, max_pages: 10, page_size: 100, requests_per_run: 20, tasks: 100, reviews: 1000, open_prs: 1000, wait_ms: 120000 },
};
const copy = (value) => JSON.parse(JSON.stringify(value));
const makeRun = (id = 1) => ({ id, run_attempt: 1, repository: { id: config.repository_id }, head_repository: { id: config.repository_id }, workflow_id: 12, head_branch: 'main', head_sha: SHA, event: 'issue_comment', triggering_actor: { id: AUTHOR } });
const plan = '<!-- delegation-task:task -->\n公開された作業\n<!-- /delegation-task -->';
const register = () => ({ schema_version: 1, operation: 'register', request_id: randomUUID(), task_key: 'feature:task', plan_path: 'docs/implementation-plans/feature.md', plan_sha: SHA, task_digest: taskDigest('公開された作業'), start_conditions_confirmed: true });

function memoryGitHub({ anchor = true, failure = null } = {}) {
  const calls = [];
  let nextComment = 2;
  let nextIssue = 10;
  const comments = anchor ? [{ id: 1, body: formatAnchor({ schema_version: 1, last_seq: 0, last_event_id: null, last_hash: ZERO_HASH }), user: { id: ACTIONS }, created_at: NOW, updated_at: NOW }] : [];
  const issues = [];
  const checks = new Map();
  const run = makeRun();
  const runs = [run];
  const failures = [];
  if (failure) failures.push(failure);
  let issuedFailure = false;
  const client = {
    calls, comments, issues, checks, run, runs, failures,
    async rest(method, path, body = null) {
      calls.push({ method, path, body: copy(body) });
      const injected = failures.find((rule) => !rule.used && rule.method === method && path.endsWith(rule.path));
      if (injected && injected.when === 'before') { injected.used = true; throw new Error('SECRET_TRANSPORT_FAILURE'); }
      let result = null;
      if (method === 'GET' && path === `/repos/${REPO}`) result = { id: config.repository_id, default_branch: 'main' };
      else if (method === 'GET' && path.includes('/actions/runs/')) result = copy(runs.find((item) => path.includes(`/runs/${item.id}/`)) ?? run);
      else if (method === 'GET' && path.includes('/actions/workflows/')) result = { path: Number(path.split('/').at(-1)) === 13 ? config.listener_workflow_path : config.controller_workflow_path };
      else if (method === 'GET' && path.includes('/branches/')) result = { protected: true, commit: { sha: SHA } };
      else if (method === 'GET' && path.includes('/compare/')) result = { status: 'identical' };
      else if (method === 'GET' && path.includes('/contents/')) {
        const text = path.includes('.progress.json') ? JSON.stringify({ feature: 'feature', stages: { design: { state: 'done', approved: { pr: 186 } } } }) : plan;
        result = { type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64'), size: text.length };
      } else if (method === 'GET' && path.endsWith('/pulls/186')) result = { number: 186, merged: true, merge_commit_sha: SHA, base: { repo: { id: config.repository_id } } };
      else if (method === 'GET' && /\/pulls\/\d+$/.test(path)) result = { number: Number(path.split('/').at(-1)), state: 'open', head: { sha: SHA }, base: { repo: { id: config.repository_id } } };
      else if (method === 'POST' && path.endsWith('/comments')) {
        result = { id: nextComment++, body: body.body, user: { id: body.body.startsWith(REQUEST_MARKER) ? AUTHOR : ACTIONS }, created_at: NOW, updated_at: NOW };
        comments.push(copy(result));
      } else if (method === 'PATCH' && path.includes('/issues/comments/')) {
        const item = comments.find((comment) => comment.id === Number(path.split('/').at(-1)));
        item.body = body.body;
        item.editor_id = ACTIONS;
        item.last_edited_at = NOW;
        result = copy(item);
      } else if (method === 'POST' && path.endsWith('/issues')) {
        result = { number: nextIssue++, body: body.body, state: 'open', user: { id: ACTIONS } };
        issues.push(copy(result));
      } else if (method === 'GET' && path.includes('/issues/')) result = Number(path.split('/').at(-1)) === 1 ? { number: 1, state: 'open' } : copy(issues.find((issue) => issue.number === Number(path.split('/').at(-1))));
      else if (method === 'POST' && path.endsWith('/check-runs')) {
        result = { ...body, id: checks.size + 1, conclusion: null };
        checks.set(result.id, copy(result));
      } else if (method === 'GET' && path.includes('/check-runs/')) result = copy(checks.get(Number(path.split('/').at(-1))));
      else if (method === 'PATCH' && path.includes('/check-runs/')) {
        const item = checks.get(Number(path.split('/').at(-1)));
        Object.assign(item, body);
        if (body.status === 'in_progress') item.conclusion = null;
        result = copy(item);
      } else throw new Error(`未実装fixture ${method} ${path}`);
      if (injected && injected.when === 'after') { injected.used = true; issuedFailure = true; throw new Error('SECRET_TRANSPORT_FAILURE'); }
      return copy(result);
    },
    async paginate(path) {
      calls.push({ method: 'PAGINATE', path });
      if (path.includes('/comments')) return copy(comments);
      if (path.includes('/actions/workflows/')) return copy(runs);
      if (path.includes('/check-runs')) return copy([...checks.values()]);
      if (path.includes('/pulls')) return [];
      if (path.includes('/issues')) return copy(issues);
      throw new Error(`未実装fixture ${path}`);
    },
    async graphql(query, variables = {}) {
      calls.push({ method: 'GRAPHQL', path: 'graphql', query, variables: copy(variables) });
      if (query.includes('lastEditedAt')) {
        const from = variables.cursor === null ? 0 : Number(variables.cursor);
        const batch = comments.slice(from, from + variables.first);
        const actor = (id) => id === null ? null : { __typename: id === ACTIONS ? 'Bot' : 'User', databaseId: id };
        return { repository: { databaseId: config.repository_id, issue: { number: config.management_issue, comments: {
          nodes: batch.map((comment) => {
            const edited = comment.created_at !== comment.updated_at;
            return { databaseId: comment.id, fullDatabaseId: String(comment.id), body: comment.body, createdAt: comment.created_at, updatedAt: comment.updated_at, author: actor(comment.user.id), editor: actor(comment.editor_id ?? (edited ? comment.user.id : null)), lastEditedAt: comment.last_edited_at ?? (edited ? comment.updated_at : null) };
          }),
          pageInfo: { hasNextPage: from + batch.length < comments.length, endCursor: from + batch.length < comments.length ? String(from + batch.length) : null },
        } } } };
      }
      return { repository: { pullRequest: { closingIssuesReferences: { nodes: [{ number: 10, repository: { databaseId: config.repository_id } }], pageInfo: { hasNextPage: false } } } } };
    },
    add(request, author = AUTHOR) {
      const comment = { id: nextComment++, body: `${REQUEST_MARKER}\n${JSON.stringify(request)}`, user: { id: author }, created_at: NOW, updated_at: NOW };
      comments.push(comment);
      return { request_id: request.request_id, request_comment_id: comment.id };
    },
    get issuedFailure() { return issuedFailure; },
  };
  return client;
}
const emptyReview = {
  async collectReviewSnapshot() { return { head_sha: SHA, open_prs: [], prs: [], snapshot_hash: 'b'.repeat(64), unknown: false }; },
  evaluateSha(snapshot) { return { status: 'completed', conclusion: 'success', target_prs: [], check: { name: 'agent-review', head_sha: snapshot.head_sha, status: 'completed', conclusion: 'success', output: { title: '確認済み', summary: '対象外' } } }; },
};
async function control(client, options = {}) { return runController({ client, config, runId: 1, runAttempt: 1, now: () => NOW, review: emptyReview, ...options }); }
test('管理Issueが未初期化ならAPIを書かず、成功checkも作らない', async () => {
  const client = memoryGitHub();
  await assert.rejects(control(client, { config: { ...config, management_issue: null, anchor_comment_id: null } }), /uninitialized/);
  assert.equal(client.calls.length, 0);
});

test('承認済みmainの公開計画とdigestを照合する', async () => {
  const client = memoryGitHub();
  const request = register();
  const { taskDigest } = await import('../scripts/delegation-shared.mjs');
  request.task_digest = taskDigest('公開された作業');
  assert.equal((await verifyPlan(client, config, request)).body, '公開された作業');
  await assert.rejects(verifyPlan(client, config, { ...request, task_digest: '0'.repeat(64) }), /content_conflict/);
  await verifyMainCommit(client, config, SHA);
  assert.equal(client.calls.filter((call) => call.path.includes('/branches/')).length, 1);
});

test('register→Issue→claim→初回begin→started→link-prを同じ履歴で結ぶ', async () => {
  const { taskDigest } = await import('../scripts/delegation-shared.mjs');
  const client = memoryGitHub();
  const request = { ...register(), task_digest: taskDigest('公開された作業') };
  const receipt = await submitRequest(client, config, request);
  const result = await control(client);
  assert.equal(result.state.tasks[request.task_key].state, 'issue_ready');
  assert.equal(client.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/issues')).length, 1);
  assert.equal((await waitForResult(client, config, { requestId: receipt.request_id, commentId: receipt.request_comment_id })).code, 'issue_ready');
  const caller = randomUUID();
  const claim = { schema_version: 1, request_id: randomUUID(), operation: 'claim', task_key: request.task_key, task_digest: request.task_digest, caller_id: caller, runner: 'local', requested_model: 'swe-2-high' };
  const claimReceipt = client.add(claim);
  await control(client);
  const claimed = await waitForResult(client, config, { requestId: claim.request_id, commentId: claimReceipt.request_comment_id });
  const activation = randomUUID();
  const begin = { schema_version: 1, request_id: randomUUID(), operation: 'begin', task_key: request.task_key, attempt_id: claimed.attempt_id, caller_id: caller, activation_id: activation };
  const beginReceipt = client.add(begin);
  await control(client);
  const allowed = await waitForResult(client, config, { requestId: begin.request_id, commentId: beginReceipt.request_comment_id, activationId: activation });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.first_delivery, true);
  assert.equal(allowed.source_run_id, 1);
  assert.match(allowed.event_hash, /^[0-9a-f]{64}$/);
  const replayReceipt = client.add(begin);
  await control(client);
  assert.equal((await waitForResult(client, config, { requestId: begin.request_id, commentId: replayReceipt.request_comment_id, activationId: activation })).allowed, false);
  const wrongActivation = await waitForResult(client, config, { requestId: begin.request_id, commentId: beginReceipt.request_comment_id, activationId: randomUUID() });
  assert.equal(wrongActivation.allowed, false);
  client.add({ schema_version: 1, request_id: randomUUID(), operation: 'started', task_key: request.task_key, attempt_id: claimed.attempt_id, caller_id: caller, activation_id: activation, session_id: 'session123', session_url: 'https://app.devin.ai/sessions/session123', observed_model: 'unknown' });
  await control(client);
  assert.equal((await readSnapshot(client, config)).tasks[request.task_key].state, 'running');
  client.add({ schema_version: 1, request_id: randomUUID(), operation: 'link-pr', task_key: request.task_key, pr: 20 });
  await control(client);
  assert.equal((await readSnapshot(client, config)).prs[20].target, true);
});

test('Issue POSTの応答喪失は1件だけ照合し、0件でも再作成しない', async () => {
  const { taskDigest } = await import('../scripts/delegation-shared.mjs');
  for (const when of ['before', 'after']) {
    const client = memoryGitHub({ failure: { method: 'POST', path: '/issues', when } });
    client.add({ ...register(), task_digest: taskDigest('公開された作業') });
    await control(client);
    const state = await readSnapshot(client, config);
    assert.equal(state.tasks['feature:task'].state, when === 'after' ? 'issue_ready' : 'issue_unknown');
    await control(client);
    assert.equal(client.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/issues')).length, 1);
  }
});

test('履歴POSTの応答喪失を照合し、先頭の保存未確認では外部起票をしない', async () => {
  const { taskDigest } = await import('../scripts/delegation-shared.mjs');
  const lost = memoryGitHub({ failure: { method: 'POST', path: '/comments', when: 'after' } });
  lost.add({ ...register(), task_digest: taskDigest('公開された作業') });
  await control(lost);
  assert.equal(lost.issuedFailure, true);
  assert.equal(lost.issues.length, 1);
  const stopped = memoryGitHub({ failure: { method: 'PATCH', path: '/issues/comments/1', when: 'before' } });
  stopped.add({ ...register(), task_digest: taskDigest('公開された作業') });
  const result = await control(stopped);
  assert.equal(result.errors[0].code, 'anchor_write_unknown');
  assert.equal(stopped.issues.length, 0);
  assert.equal((await readSnapshot(stopped, config)).recovery, true);
  await control(stopped);
  assert.equal((await readSnapshot(stopped, config)).recovery, false);
});

test('registeredの先頭保存失敗を回復し、起票意図の確定後に1回だけIssueを作る', async () => {
  const client = memoryGitHub({ failure: { method: 'PATCH', path: '/issues/comments/1', when: 'before' } });
  const request = register();
  const receipt = client.add(request);
  const failed = await control(client);
  assert.equal(failed.errors[0].code, 'anchor_write_unknown');
  assert.equal(failed.remaining, 0);
  assert.equal(failed.state.tasks[request.task_key].state, 'registered');
  assert.equal(client.issues.length, 0);
  const resumed = await control(client);
  assert.equal(resumed.state.tasks[request.task_key].state, 'issue_ready');
  assert.equal((await waitForResult(client, config, { requestId: request.request_id, commentId: receipt.request_comment_id })).code, 'issue_ready');
  const creating = client.calls.findIndex((call) => call.method === 'POST' && call.path.endsWith('/comments') && call.body.body.includes('"state":"issue_creating"'));
  const issuePost = client.calls.findIndex((call) => call.method === 'POST' && call.path.endsWith('/issues'));
  assert.ok(creating >= 0 && creating < issuePost);
  await control(client);
  assert.equal(client.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/issues')).length, 1);
});

test('登録復旧でもmain計画の再照合又は起票意図保存が失敗したらIssue POSTしない', async () => {
  for (const stage of ['plan', 'intent']) {
    const client = memoryGitHub({ failure: { method: 'PATCH', path: '/issues/comments/1', when: 'before' } });
    client.add(register());
    await control(client);
    client.failures.push(stage === 'plan'
      ? { method: 'GET', path: `/contents/docs/discussions/feature.progress.json?ref=${SHA}`, when: 'before' }
      : { method: 'POST', path: '/comments', when: 'before' });
    await assert.rejects(control(client));
    assert.equal(client.issues.length, 0);
    assert.equal(client.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/issues')).length, 0);
  }
});

test('Issue作成後の最終追記失敗は照合だけで元の受付結果を回復する', async () => {
  const client = memoryGitHub();
  const rest = client.rest.bind(client);
  let failed = false;
  client.rest = async (method, path, body) => {
    if (!failed && method === 'POST' && path.endsWith('/comments') && body?.body?.includes('"code":"issue_ready"')) {
      failed = true;
      throw new Error('SECRET');
    }
    return rest(method, path, body);
  };
  const request = register();
  const receipt = client.add(request);
  const stopped = await control(client);
  assert.equal(stopped.errors[0].code, 'journal_write_unknown');
  assert.equal(stopped.state.tasks[request.task_key].state, 'issue_creating');
  assert.equal(client.issues.length, 1);
  await control(client);
  const result = await waitForResult(client, config, { requestId: request.request_id, commentId: receipt.request_comment_id });
  assert.equal(result.code, 'issue_ready');
  assert.equal(result.issue, 10);
  assert.equal(client.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/issues')).length, 1);
});

test('全コメントを読み、100件を越える要求のうち20件だけ処理する', async () => {
  const { taskDigest } = await import('../scripts/delegation-shared.mjs');
  const client = memoryGitHub();
  for (let n = 0; n < 105; n += 1) client.add({ ...register(), task_digest: taskDigest('公開された作業') });
  const result = await control(client);
  assert.equal(result.processed, 20);
  assert.equal(result.remaining, 85);
  assert.equal(client.issues.length, 1);
});

test('未許可作者と編集済み要求を枠前に除外し、後続の正当要求を処理する', async () => {
  const client = memoryGitHub();
  for (let n = 0; n < 25; n += 1) {
    client.add({ raw_prompt: 'SECRET' }, 99);
    client.comments.at(-1).body = `${REQUEST_MARKER}\nSECRET_NOT_JSON`;
    client.add(register());
    client.comments.at(-1).updated_at = '2026-10-09T11:00:00Z';
  }
  client.add(register());
  const result = await control(client);
  assert.deepEqual([result.processed, result.rejected, result.skipped, result.remaining], [1, 0, 50, 0]);
  assert.deepEqual(result.errors, []);
  assert.equal(client.issues.length, 1);
  assert.equal(Object.values(result.state.requests).length, 1);
  assert.equal((await control(client)).remaining, 0);
});

test('REST時刻が同じ秒でもlastEditedAt/editorがある要求は枠前に拒否する', async () => {
  const client = memoryGitHub();
  for (const editor of [AUTHOR, 99, null]) {
    client.add(register());
    const comment = client.comments.at(-1);
    comment.editor_id = editor;
    comment.last_edited_at = NOW;
    assert.equal(comment.created_at, comment.updated_at);
  }
  client.add(register());
  const result = await control(client);
  assert.deepEqual([result.processed, result.rejected, result.skipped, result.remaining], [1, 0, 3, 0]);
  assert.equal(client.issues.length, 1);
  assert.equal(Object.values(result.state.requests).length, 1);
});

test('許可者の不正要求は一般的な拒否だけを保存し、次回の受付枠を占めない', async () => {
  const client = memoryGitHub();
  for (let n = 0; n < 20; n += 1) {
    client.add({ raw_prompt: 'SECRET' });
    if (n % 3 === 0) client.comments.at(-1).body = `${REQUEST_MARKER}\nSECRET_NOT_JSON`;
    if (n % 3 === 1) client.comments.at(-1).body = `${REQUEST_MARKER}\n${'SECRET'.repeat(1500)}`;
  }
  client.add(register());
  const first = await control(client);
  assert.deepEqual([first.processed, first.rejected, first.skipped, first.remaining], [0, 20, 0, 1]);
  assert.equal(first.errors.length, 20);
  assert.equal(first.errors.every((error) => error.code === 'request_rejected'), true);
  assert.equal(Object.values(first.state.requests).every((record) => record.result.code === 'request_rejected' && record.result.allowed === false), true);
  assert.equal(client.comments.filter((comment) => comment.body.startsWith(EVENT_MARKER)).some((comment) => comment.body.includes('SECRET')), false);
  const second = await control(client);
  assert.deepEqual([second.processed, second.rejected, second.skipped, second.remaining], [1, 0, 0, 0]);
  assert.equal(second.errors.length, 0);
  assert.equal(client.issues.length, 1);
  assert.equal((await control(client)).processed, 0);
});

test('拒否の保存が不明なら再送せず停止し、未受理を残件として数える', async () => {
  const client = memoryGitHub({ failure: { method: 'POST', path: '/comments', when: 'before' } });
  client.add({ raw_prompt: 'SECRET' });
  client.add(register());
  const result = await control(client);
  assert.deepEqual([result.processed, result.rejected, result.skipped, result.remaining], [0, 0, 0, 2]);
  assert.deepEqual(result.errors.map((error) => error.code), ['journal_write_unknown']);
  assert.equal(client.calls.filter((call) => call.method === 'POST').length, 1);
  assert.equal(client.issues.length, 0);
});

test('同callerでもrunner又はmodelが変わるclaimは予約を変えず拒否する', async () => {
  const client = memoryGitHub();
  const task = register();
  client.add(task);
  await control(client);
  const claim = { schema_version: 1, operation: 'claim', request_id: randomUUID(), task_key: task.task_key, task_digest: task.task_digest, caller_id: randomUUID(), runner: 'local', requested_model: 'swe-2-high' };
  client.add(claim);
  const reserved = await control(client);
  const attempt = reserved.state.tasks[task.task_key].attempt_id;
  for (const change of [{ runner: 'cloud' }, { requested_model: 'swe-2-medium' }]) {
    const changed = { ...claim, ...change, request_id: randomUUID() };
    const receipt = client.add(changed);
    const result = await control(client);
    assert.equal((await waitForResult(client, config, { requestId: changed.request_id, commentId: receipt.request_comment_id })).code, 'configuration_conflict');
    assert.equal(result.state.tasks[task.task_key].attempt_id, attempt);
    assert.equal(result.state.tasks[task.task_key].runner, 'local');
    assert.equal(result.state.tasks[task.task_key].requested_model, 'swe-2-high');
  }
});

test('同requestの別内容は既存結果を変えず、未処理を繰り返さない', async () => {
  const client = memoryGitHub();
  const imported = { schema_version: 1, request_id: randomUUID(), operation: 'import', task_key: 'feature:task', task_digest: 'b'.repeat(64), issue: 10 };
  client.issues.push({ number: 10, state: 'open', body: '', user: { id: AUTHOR } });
  client.add(imported);
  await control(client);
  const conflict = client.add({ ...imported, task_digest: 'c'.repeat(64) });
  await control(client);
  const observed = await waitForResult(client, config, { requestId: imported.request_id, commentId: conflict.request_comment_id });
  assert.equal(observed.code, 'request_conflict');
  assert.equal((await readSnapshot(client, config)).tasks['feature:task'].task_digest, 'b'.repeat(64));
  assert.equal((await control(client)).processed, 0);
});

test('固定runのrepo/workflow/branch/SHA/attemptを検証し、作者だけでは履歴を信じない', async () => {
  for (const change of [{ repository: { id: 2 } }, { head_repository: { id: 2 } }, { workflow_id: 99 }, { head_branch: 'devin/x' }, { event: 'pull_request' }, { run_attempt: 2 }, { head_sha: 'short' }]) {
    const client = memoryGitHub();
    Object.assign(client.run, change);
    await assert.rejects(verifyControlRun(client, config, 1, 1), /run_unverified/);
  }
  const client = memoryGitHub();
  client.comments[0].user.id = AUTHOR;
  await assert.rejects(readSnapshot(client, config), /anchor_author_unverified/);
  const untrusted = memoryGitHub();
  const state = await persistEvent(untrusted, config, await readSnapshot(untrusted, config), {}, { source_run_id: 1, source_run_attempt: 1, request_id: null, request_comment_id: null, operation: 'test' }, { code: 'confirmed', allowed: false });
  assert.equal(state.seq, 1);
  untrusted.comments.find((comment) => comment.body.startsWith(EVENT_MARKER)).updated_at = '2026-10-09T11:00:00Z';
  await assert.rejects(readSnapshot(untrusted, config), /journal_author_unverified/);
});

test('未許可作者の偽eventをparseせず、Actions作者の破損は停止する', async () => {
  const client = memoryGitHub();
  client.add({});
  client.comments.at(-1).body = `${EVENT_MARKER}\nSECRET_NOT_JSON`;
  let state = await readSnapshot(client, config);
  assert.equal(state.seq, 0);
  state = await persistEvent(client, config, state, {}, { source_run_id: 1, source_run_attempt: 1, request_id: null, request_comment_id: null, operation: 'test' }, { code: 'confirmed', allowed: false });
  assert.equal(state.seq, 1);
  client.add({}, ACTIONS);
  client.comments.at(-1).body = `${EVENT_MARKER}\nSECRET_NOT_JSON`;
  await assert.rejects(readSnapshot(client, config), /invalid_json/);
});

test('同じ秒のjournal編集もActions本人による編集も停止する', async () => {
  for (const editor of [ACTIONS, AUTHOR, null]) {
    const client = memoryGitHub();
    await persistEvent(client, config, await readSnapshot(client, config), {}, { source_run_id: 1, source_run_attempt: 1, request_id: null, request_comment_id: null, operation: 'test' }, { code: 'confirmed', allowed: false });
    const event = client.comments.find((comment) => comment.body.startsWith(EVENT_MARKER));
    event.editor_id = editor;
    event.last_edited_at = NOW;
    assert.equal(event.created_at, event.updated_at);
    await assert.rejects(control(client), /journal_author_unverified/);
  }
});

test('anchorの同秒更新はActionsだけを認め、他作者のeditorや不明editorを拒否する', async () => {
  for (const editor of [ACTIONS, AUTHOR, null]) {
    const client = memoryGitHub();
    client.comments[0].editor_id = editor;
    client.comments[0].last_edited_at = NOW;
    assert.equal(client.comments[0].created_at, client.comments[0].updated_at);
    if (editor === ACTIONS) assert.equal((await readSnapshot(client, config)).seq, 0);
    else await assert.rejects(readSnapshot(client, config), /anchor_author_unverified/);
  }
});

test('GraphQL編集情報の取得失敗・不足・別repoをREST時刻で補わず外部書込前に停止する', async () => {
  for (const kind of ['throw', 'missing-editor', 'missing-edited', 'repo', 'unknown-author']) {
    const client = memoryGitHub();
    client.add(register());
    const graphql = client.graphql.bind(client);
    client.graphql = async (query, variables) => {
      if (kind === 'throw') throw new Error('SECRET');
      const response = await graphql(query, variables);
      if (kind === 'repo') response.repository.databaseId = 99;
      if (kind === 'missing-editor') delete response.repository.issue.comments.nodes[0].editor;
      if (kind === 'missing-edited') delete response.repository.issue.comments.nodes[0].lastEditedAt;
      if (kind === 'unknown-author') response.repository.issue.comments.nodes[0].author = null;
      return response;
    };
    await assert.rejects(control(client), kind === 'unknown-author' ? /anchor_author_unverified/ : /comments_unknown/);
    assert.equal(client.calls.some((call) => call.method === 'POST' || call.method === 'PATCH'), false);
    assert.equal(client.calls.some((call) => call.method === 'PAGINATE' && call.path.includes('/comments')), false);
  }
});

test('GraphQLコメント全頁を読み、後頁・件数・ページ・cursorの不明は部分状態を返さない', async () => {
  const client = memoryGitHub();
  for (let n = 0; n < 105; n += 1) client.add({});
  const comments = await readIssueComments(client, config);
  assert.equal(comments.length, 106);
  assert.deepEqual(client.calls.filter((call) => call.method === 'GRAPHQL').map((call) => call.variables.cursor), [null, '100']);
  await assert.rejects(readIssueComments(client, { ...config, limits: { ...config.limits, max_pages: 1 } }), /comment_limit/);
  await assert.rejects(readIssueComments(client, { ...config, limits: { ...config.limits, comments: 106 } }), /comment_limit/);
  const graphql = client.graphql.bind(client);
  client.graphql = async (query, variables) => {
    if (variables.cursor !== null) throw new Error('SECRET');
    return graphql(query, variables);
  };
  await assert.rejects(readSnapshot(client, config), /comments_unknown/);
  client.graphql = async (query, variables) => {
    const response = await graphql(query, { ...variables, cursor: null });
    response.repository.issue.comments.pageInfo.endCursor = 'repeat';
    return response;
  };
  await assert.rejects(readSnapshot(client, config), /comments_unknown/);
});

test('GraphQL作者・editor照合と要求20件の処理を共通API200回予算に数える', async () => {
  const memory = memoryGitHub();
  for (let n = 0; n < 105; n += 1) memory.add({ schema_version: 1, operation: 'reconcile', request_id: randomUUID() });
  const client = createGitHubClient({ repo: REPO, maxApiCalls: 200, sleep: async () => {}, execute: async ({ args, input }) => {
    const method = args[args.indexOf('--method') + 1];
    const path = args[args.indexOf('--method') + 2];
    const body = input === null ? null : JSON.parse(input);
    const data = path === 'graphql' ? { data: await memory.graphql(body.query, body.variables) } : await memory.rest(method, `/${path}`, body);
    return { status: 200, headers: {}, data };
  } });
  const result = await control(client);
  assert.equal(result.processed, 20);
  assert.equal(result.remaining, 85);
  assert.ok(client.calls <= 200);
  assert.equal(memory.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/comments')).length, 20);
  const bounded = createGitHubClient({ repo: REPO, maxApiCalls: 1, execute: async () => ({ status: 200, headers: {}, data: { id: config.repository_id, default_branch: 'main' } }) });
  await assert.rejects(readSnapshot(bounded, config), /comments_unknown/);
  assert.equal(bounded.calls, 1);
});

test('過去runをまとめて読み、workflow/mainの共通確認を実行内で再利用する', async () => {
  const client = memoryGitHub();
  let state = await readSnapshot(client, config);
  for (let id = 1; id <= 60; id += 1) {
    if (id > 1) client.runs.push(makeRun(id));
    state = await persistEvent(client, config, state, {}, { source_run_id: id, source_run_attempt: 1, request_id: null, request_comment_id: null, operation: 'test' }, { code: 'confirmed', allowed: false });
  }
  // 新しいwriterは過去の全runを一括取得し、共通のmain照合を1回にする。
  const fresh = memoryGitHub();
  fresh.comments.splice(0, fresh.comments.length, ...copy(client.comments));
  fresh.runs.splice(0, fresh.runs.length, ...copy(client.runs));
  assert.equal((await readSnapshot(fresh, config)).seq, 60);
  assert.equal(fresh.calls.filter((call) => call.path.includes('/branches/')).length, 1);
  assert.equal(fresh.calls.filter((call) => call.path.includes('/compare/')).length, 1);
  assert.equal(fresh.calls.filter((call) => call.path.includes('/actions/runs/')).length, 0);
});

test('checkを1つ保持し、再確認中は共有状態もpending、最終API確認後だけsuccess', async () => {
  const client = memoryGitHub();
  let state = await readSnapshot(client, config);
  const review = { ...emptyReview, async collectReviewSnapshot() {
    assert.equal((await readSnapshot(client, config)).checks[SHA].state, 'in_progress');
    assert.equal((await readSnapshot(client, config)).checks[SHA].conclusion, null);
    return emptyReview.collectReviewSnapshot();
  } };
  state = await refreshSha(client, config, state, client.run, SHA, review);
  assert.equal(state.checks[SHA].conclusion, 'success');
  await refreshSha(client, config, state, client.run, SHA, review);
  assert.equal(client.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/check-runs')).length, 1);
});

test('最終収集の変化・例外・Check PATCH失敗で共有successを残さない', async () => {
  for (const kind of ['changed', 'throw', 'patch']) {
    const client = memoryGitHub();
    let calls = 0;
    const review = { ...emptyReview, async collectReviewSnapshot() {
      calls += 1;
      if (calls === 3 && kind === 'throw') throw new Error('SECRET');
      const snapshot = await emptyReview.collectReviewSnapshot();
      if (calls === 3 && kind === 'changed') snapshot.snapshot_hash = 'c'.repeat(64);
      if (calls === 3 && kind === 'patch') client.failures.push({ method: 'PATCH', path: '/check-runs/1', when: 'before' });
      return snapshot;
    } };
    try { await refreshSha(client, config, await readSnapshot(client, config), client.run, SHA, review); } catch (error) { assert.equal(kind === 'throw' || kind === 'patch', true); }
    const state = await readSnapshot(client, config);
    assert.equal(state.checks[SHA].state, 'in_progress');
    assert.equal(state.checks[SHA].conclusion, null);
  }
});

test('証拠取得unknownでもlive対象を先に保存し、branch改名で対象を失わない', async () => {
  const client = memoryGitHub();
  let collected = 0;
  const review = {
    ...emptyReview,
    async collectReviewSnapshot(_client, _config, _head, { registeredPrs }) {
      collected += 1;
      if (collected > 1) assert.equal(registeredPrs[20].target, true);
      return { head_sha: SHA, open_prs: [{ pr: 20, head_sha: SHA, head_ref: collected === 1 ? 'devin/local' : 'feature/renamed', target: collected === 1 }], prs: [], snapshot_hash: 'b'.repeat(64), unknown: true };
    },
  };
  const state = await refreshSha(client, config, await readSnapshot(client, config), client.run, SHA, review);
  assert.equal(state.prs[20].target, true);
  assert.equal(state.checks[SHA].state, 'in_progress');
  assert.equal(state.checks[SHA].conclusion, null);
});

test('closing Issuesが100件を越えても最後まで照合し、途中失敗はリンクしない', async () => {
  for (const partialFailure of [false, true]) {
    const client = memoryGitHub();
    client.issues.push({ number: 10, body: '', state: 'open', user: { id: AUTHOR } });
    client.add({ schema_version: 1, request_id: randomUUID(), operation: 'import', task_key: 'feature:task', task_digest: 'b'.repeat(64), issue: 10, state: 'issue_ready' });
    await control(client);
    const cursors = [];
    const graphql = client.graphql.bind(client);
    client.graphql = async (query, variables) => {
      if (!query.includes('closingIssuesReferences')) return graphql(query, variables);
      assert.match(query, /repository\{databaseId\}/);
      cursors.push(variables.cursor);
      if (partialFailure && variables.cursor !== null) throw new Error('SECRET');
      return { repository: { pullRequest: { closingIssuesReferences: {
        nodes: variables.cursor === null ? Array.from({ length: 100 }, (_, n) => ({ number: n + 1, repository: { databaseId: config.repository_id } })) : [{ number: 101, repository: { databaseId: config.repository_id } }],
        pageInfo: { hasNextPage: variables.cursor === null, endCursor: variables.cursor === null ? 'next' : null },
      } } } };
    };
    client.add({ schema_version: 1, request_id: randomUUID(), operation: 'link-pr', task_key: 'feature:task', pr: 20 });
    await control(client);
    assert.deepEqual(cursors, [null, 'next']);
    assert.equal((await readSnapshot(client, config)).prs[20]?.target === true, !partialFailure);
  }
});

test('closing Issueはnumberとrepoを照合し、別repoの同番号だけではリンクしない', async () => {
  for (const repositoryId of [config.repository_id, 999, null]) {
    const client = memoryGitHub();
    client.issues.push({ number: 10, body: '', state: 'open', user: { id: AUTHOR } });
    client.add({ schema_version: 1, request_id: randomUUID(), operation: 'import', task_key: 'feature:task', task_digest: 'b'.repeat(64), issue: 10, state: 'issue_ready' });
    await control(client);
    const graphql = client.graphql.bind(client);
    client.graphql = async (query, variables) => query.includes('closingIssuesReferences') ? { repository: { pullRequest: { closingIssuesReferences: { nodes: [{ number: 10, repository: { databaseId: repositoryId } }], pageInfo: { hasNextPage: false } } } } } : graphql(query, variables);
    const link = { schema_version: 1, request_id: randomUUID(), operation: 'link-pr', task_key: 'feature:task', pr: 20 };
    const receipt = client.add(link);
    const result = await control(client);
    const receiptResult = await waitForResult(client, config, { requestId: link.request_id, commentId: receipt.request_comment_id });
    assert.equal(result.state.prs[20]?.target === true, repositoryId === config.repository_id);
    assert.equal(receiptResult.code, repositoryId === config.repository_id ? 'linked' : repositoryId === null ? 'pr_link_unknown' : 'pr_link_unverified');
  }
});

test('最後のclosing Issueページに自repoがあれば、前頁の別repo同番号と区別してリンクする', async () => {
  const client = memoryGitHub();
  client.issues.push({ number: 10, body: '', state: 'open', user: { id: AUTHOR } });
  client.add({ schema_version: 1, request_id: randomUUID(), operation: 'import', task_key: 'feature:task', task_digest: 'b'.repeat(64), issue: 10, state: 'issue_ready' });
  await control(client);
  const cursors = [];
  const graphql = client.graphql.bind(client);
  client.graphql = async (query, variables) => {
    if (!query.includes('closingIssuesReferences')) return graphql(query, variables);
    const { cursor } = variables;
    cursors.push(cursor);
    return { repository: { pullRequest: { closingIssuesReferences: {
      nodes: cursor === null ? Array.from({ length: 100 }, () => ({ number: 10, repository: { databaseId: 999 } })) : [{ number: 10, repository: { databaseId: config.repository_id } }],
      pageInfo: { hasNextPage: cursor === null, endCursor: cursor === null ? 'next' : null },
    } } } };
  };
  client.add({ schema_version: 1, request_id: randomUUID(), operation: 'link-pr', task_key: 'feature:task', pr: 20 });
  assert.equal((await control(client)).state.prs[20].target, true);
  assert.deepEqual(cursors, [null, 'next']);
});

test('checkoutしたSHAが制御runのheadと違えば、状態を書かない', async () => {
  const client = memoryGitHub();
  await assert.rejects(control(client, { runtimeSha: 'b'.repeat(40) }), /run_unverified/);
  assert.equal(client.calls.some((call) => call.method === 'POST' || call.method === 'PATCH'), false);
});

test('check create応答不明は同external_idを照合し、見つからなくても再POSTしない', async () => {
  for (const when of ['before', 'after']) {
    const client = memoryGitHub({ failure: { method: 'POST', path: '/check-runs', when } });
    try { await refreshSha(client, config, await readSnapshot(client, config), client.run, SHA, emptyReview); } catch (error) { assert.equal(when, 'before'); assert.match(error.code, /check_create_unknown/); }
    if (when === 'before') await assert.rejects(refreshSha(client, config, await readSnapshot(client, config), client.run, SHA, emptyReview), /check_create_unknown/);
    assert.equal(client.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/check-runs')).length, 1);
  }
});

test('refresh開始のCheck PATCH/GET不明でも、共有状態は先にpendingになる', async () => {
  for (const method of ['PATCH', 'GET']) {
    const client = memoryGitHub();
    let state = await refreshSha(client, config, await readSnapshot(client, config), client.run, SHA, emptyReview);
    assert.equal(state.checks[SHA].conclusion, 'success');
    client.failures.push({ method, path: '/check-runs/1', when: 'before' });
    await assert.rejects(refreshSha(client, config, state, client.run, SHA, emptyReview));
    state = await readSnapshot(client, config);
    assert.equal(state.checks[SHA].state, 'in_progress');
    assert.equal(state.checks[SHA].conclusion, null);
  }
});

test('起票結果の0/1/2件を区別して、外部作成物を削除しない', async () => {
  const client = memoryGitHub();
  const task = { task_key: 'feature:task', task_digest: 'b'.repeat(64), issue_attempt_id: randomUUID() };
  const body = '<!-- tomotabi-delegation-task -->\n' + JSON.stringify(task) + '\n\npublic task';
  assert.equal(await findCreatedIssue(client, config, task), null);
  client.issues.push({ number: 10, body, user: { id: ACTIONS } });
  assert.equal((await findCreatedIssue(client, config, task)).number, 10);
  client.issues.push({ number: 11, body, user: { id: ACTIONS } });
  await assert.rejects(findCreatedIssue(client, config, task), /issue_conflict/);
  assert.equal(client.issues.length, 2);
});

test('偽taskとanchorは作者を先に除外し、Actions作者の破損は停止する', async () => {
  const client = memoryGitHub();
  const task = { task_key: 'feature:task', task_digest: 'b'.repeat(64), issue_attempt_id: randomUUID() };
  client.issues.push({ number: 10, body: `${TASK_MARKER}\nSECRET_NOT_JSON`, user: { id: AUTHOR } });
  assert.equal(await findCreatedIssue(client, config, task), null);
  client.issues.push({ number: 11, body: `${TASK_MARKER}\n${JSON.stringify(task)}`, user: { id: ACTIONS } });
  assert.equal((await findCreatedIssue(client, config, task)).number, 11);
  client.add({});
  client.comments.at(-1).body = `${ANCHOR_MARKER}\nSECRET_NOT_JSON`;
  client.run.event = 'workflow_dispatch';
  const event = { inputs: { operation: 'initialize' }, sender: { id: AUTHOR } };
  assert.equal((await initializeAnchor(client, config, client.run, event)).anchor_comment_id, 1);
  client.issues.push({ number: 12, body: `${TASK_MARKER}\nSECRET_NOT_JSON`, user: { id: ACTIONS } });
  await assert.rejects(findCreatedIssue(client, config, task), /issue_marker_unknown/);
  client.comments[0].body = `${ANCHOR_MARKER}\nSECRET_NOT_JSON`;
  await assert.rejects(initializeAnchor(client, config, client.run, event), /invalid_json/);
});

test('bootstrapはActionsのanchorを1回作り、初回journal後も読める', async () => {
  const client = memoryGitHub({ anchor: false });
  client.run.event = 'workflow_dispatch';
  const event = { inputs: { operation: 'initialize' }, sender: { id: AUTHOR } };
  const boot = await control(client, { config: { ...config, anchor_comment_id: null }, event });
  const readyConfig = { ...config, anchor_comment_id: boot.anchor_comment_id };
  assert.equal(boot.code, 'anchor_initialized');
  assert.equal(client.comments[0].user.id, ACTIONS);
  assert.equal((await initializeAnchor(client, readyConfig, client.run, event)).anchor_comment_id, boot.anchor_comment_id);
  const state = await persistEvent(client, readyConfig, await readSnapshot(client, readyConfig), {}, { source_run_id: 1, source_run_attempt: 1, request_id: null, request_comment_id: null, operation: 'bootstrap-test' }, { code: 'confirmed', allowed: false });
  assert.equal(state.seq, 1);
});

test('bootstrapの複数anchor・不正作者・応答喪失は再POSTしない', async () => {
  const event = { inputs: { operation: 'initialize' }, sender: { id: AUTHOR } };
  const duplicated = memoryGitHub();
  duplicated.run.event = 'workflow_dispatch';
  duplicated.comments.push({ ...copy(duplicated.comments[0]), id: 2 });
  await assert.rejects(initializeAnchor(duplicated, config, duplicated.run, event), /anchor_conflict/);
  const bad = memoryGitHub({ anchor: false });
  bad.run.event = 'workflow_dispatch';
  await assert.rejects(initializeAnchor(bad, config, bad.run, { ...event, sender: { id: 99 } }), /initialize_unauthorized/);
  for (const when of ['before', 'after']) {
    const client = memoryGitHub({ anchor: false, failure: { method: 'POST', path: '/comments', when } });
    client.run.event = 'workflow_dispatch';
    try { await initializeAnchor(client, config, client.run, event); } catch (error) { assert.equal(when, 'before'); assert.equal(error.code, 'initialize_unknown'); }
    client.runs.push({ ...makeRun(2), event: 'workflow_dispatch' });
    try { await initializeAnchor(client, config, client.runs[1], event); } catch (error) { assert.equal(when, 'before'); assert.equal(error.code, 'initialize_unknown'); }
    assert.equal(client.calls.filter((call) => call.method === 'POST').length, 1);
  }
});

function zipJson(value, filename = 'notification.json') {
  const name = Buffer.from(filename);
  const data = Buffer.from(JSON.stringify(value));
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}
test('通知ZIPは8KiB以下の固定JSON1件だけ読み、任意パスに展開しない', () => {
  const value = { schema_version: 1, repository_id: config.repository_id, pr: 20, event: 'pull_request', run_id: 9 };
  assert.deepEqual(decodeNotificationZip(zipJson(value)), value);
  assert.throws(() => decodeNotificationZip(zipJson(value, '../../notification.json')), /notification_unknown/);
  assert.throws(() => decodeNotificationZip(zipJson({ ...value, raw_prompt: 'SECRET' })), /notification_unknown/);
  assert.throws(() => decodeNotificationZip(zipJson(value), { maxBytes: 4 }), /notification_unknown/);
  assert.throws(() => decodeNotificationZip(Buffer.from('broken')), /notification_unknown/);
});

test('待機期限と受領ID違いで許可を返さない', async () => {
  const client = memoryGitHub();
  await assert.rejects(waitForResult(client, config, { requestId: randomUUID(), commentId: 3, timeoutMs: 0 }), /result_pending/);
  await assert.rejects(waitForResult(client, config, { requestId: 'invalid', commentId: 3 }), /invalid_receipt/);
  await assert.rejects(submitRequest(client, { ...config, anchor_comment_id: null }, { schema_version: 1, request_id: randomUUID(), operation: 'reconcile' }), /uninitialized/);
});

test('begin以外の同要求の再送は元の確定結果とsource照合情報を返す', async () => {
  const client = memoryGitHub();
  const request = register();
  const original = client.add(request);
  await control(client);
  const originalResult = await waitForResult(client, config, { requestId: request.request_id, commentId: original.request_comment_id });
  const replay = client.add(request);
  await control(client);
  const result = await waitForResult(client, config, { requestId: request.request_id, commentId: replay.request_comment_id });
  assert.equal(result.code, 'issue_ready');
  assert.equal(result.issue, originalResult.issue);
  assert.equal(result.allowed, false);
  assert.equal(result.source_run_id, originalResult.source_run_id);
  assert.equal(result.source_run_attempt, originalResult.source_run_attempt);
  assert.equal(result.event_hash, originalResult.event_hash);
  assert.equal(result.request_comment_id, replay.request_comment_id);
  await assert.rejects(waitForResult(client, config, { requestId: request.request_id, commentId: 999 }), /result_pending/);
});
