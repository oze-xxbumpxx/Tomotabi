import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDevinArgs, consumeBeginReceipt, launchDelegation, parseLaunchArgs, reserveSpent, runLaunchCli } from '../scripts/delegation-launch.mjs';

const id = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const baseConfig = JSON.parse(readFileSync(new URL('../config/delegation-review.json', import.meta.url), 'utf8'));
const config = { ...baseConfig, management_issue: 50, anchor_comment_id: 60, controller_workflow_id: 70, migration_complete: true, cli_launch_verified: true };
const caller = id(20);
const attempt = id(30);
const digest = 'a'.repeat(64);
const expected = { requestId: id(3), commentId: 103, attemptId: attempt, callerId: caller, activationId: id(1), sourceRunId: 5, sourceRunAttempt: 1 };
const receipt = { code: 'begin_allowed', allowed: true, first_delivery: true, request_id: expected.requestId, request_comment_id: 103, attempt_id: attempt, caller_id: caller, activation_id: id(1), source_run_id: 5, source_run_attempt: 1, event_hash: digest };

async function fixture(fn, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'delegation-launch-'));
  try {
    const prompt = join(dir, 'prompt.txt');
    writeFileSync(prompt, 'PRIVATE PROMPT sentinel', { mode: 0o600 });
    let counter = 0;
    let spawnCount = 0;
    const submissions = [];
    let begun = false;
    const dependencies = {
      config, stateDir: dir, uuid: () => id(++counter),
      readSnapshot: async (client) => {
        // 実transport生成を通す。repoを渡し忘れるとこの前に停止する。
        assert.equal(client.repo, config.repository);
        assert.equal(typeof client.rest, 'function');
        return { tasks: { 'feature:task': { task_key: 'feature:task', task_digest: digest, issue: 81 } } };
      },
      submitRequest: async (_client, _config, request) => {
        const commentId = 100 + submissions.length + 1;
        submissions.push({ ...request, commentId });
        return { request_id: request.request_id, request_comment_id: commentId };
      },
      waitForResult: async (_client, _config, { requestId, commentId }) => {
        const request = submissions.find((r) => r.request_id === requestId);
        if (request.operation === 'claim') return { code: begun ? 'task_not_ready' : 'reserved', attempt_id: attempt };
        if (request.operation === 'begin') {
          begun = true;
          return { ...receipt, request_id: requestId, request_comment_id: commentId, activation_id: request.activation_id };
        }
        return { code: request.session_id === null ? 'launch_unknown' : 'running' };
      },
      spawnOnce: async (input) => {
        spawnCount += 1;
        assert.ok(existsSync(join(dir, 'delegation-spent', `${id(1)}.spent`)));
        assert.deepEqual(input.args.slice(-2), ['--prompt-file', realpathSync(prompt)]);
        assert.doesNotMatch(JSON.stringify(input.args), /PRIVATE PROMPT/);
        return { session_id: 'session-1', session_url: 'https://app.devin.ai/sessions/session-1', observed_model: 'swe-2-high' };
      },
      ...overrides,
    };
    const options = { taskKey: 'feature:task', callerId: caller, runner: 'local', model: 'swe-2-high', promptFile: prompt, clone: null };
    await fn({ dir, prompt, dependencies, options, submissions, count: () => spawnCount });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('I-12: runner/model/prompt fileを明示し、activationの持ち込みを拒む', () => {
  const options = parseLaunchArgs(['feature:task', '--runner', 'cloud', '--model', 'swe-2-high', '--prompt-file', '/private/prompt']);
  assert.deepEqual([options.taskKey, options.runner, options.model], ['feature:task', 'cloud', 'swe-2-high']);
  assert.throws(() => parseLaunchArgs(['feature:task', '--model', 'swe-2-high', '--prompt-file', '/p']));
  assert.throws(() => parseLaunchArgs(['feature:task', '--runner', 'local', '--model', 'unknown', '--prompt-file', '/p']));
  assert.throws(() => parseLaunchArgs(['feature:task', '--runner', 'local', '--model', 'swe-2-high', '--prompt-file', '/p', '--activation-id', id(1)]));
  assert.deepEqual(buildDevinArgs({ runner: 'cloud', model: 'swe-2-high', promptFile: '/p' }), ['--cloud', '--model', 'swe-2-high', '--permission-mode', 'dangerous', '-p', '--prompt-file', '/p']);
  assert.throws(() => buildDevinArgs({ runner: 'local', model: 'unknown', promptFile: '/p' }));
});

test('I-09: 一致する初回受領だけを使い、別run/attempt/activationとreplayを拒む', () => {
  assert.equal(consumeBeginReceipt(receipt, expected), true);
  for (const patch of [{ allowed: false }, { first_delivery: false }, { code: 'already_begun' }, { request_id: id(99) }, { request_comment_id: 999 }, { attempt_id: id(98) }, { activation_id: id(97) }, { caller_id: id(96) }, { source_run_id: 6 }, { source_run_attempt: 2 }, { source_run_id: null }, { event_hash: 'short' }]) {
    assert.equal(consumeBeginReceipt({ ...receipt, ...patch }, expected), false, JSON.stringify(patch));
  }
  assert.equal(consumeBeginReceipt(null, expected), false);
});

test('I-01/I-10/I-13: transport生成からspent→1回spawn→startedを通し、秘密を公開しない', async () => {
  await fixture(async ({ dir, dependencies, options, submissions, count }) => {
    const result = await launchDelegation(options, dependencies);
    assert.equal(result.state, 'running');
    assert.equal(result.exitCode, 0);
    assert.equal(count(), 1);
    assert.deepEqual(submissions.map((r) => r.operation), ['claim', 'begin', 'started']);
    assert.equal(submissions[1].activation_id, id(1));
    assert.equal(submissions[2].session_id, 'session-1');
    assert.equal(statSync(join(dir, 'delegation-spent', `${id(1)}.spent`)).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, 'devin-logs', 'issue-81.log')).mode & 0o777, 0o600);
    assert.doesNotMatch(JSON.stringify({ result, submissions }), /PRIVATE PROMPT|prompt-file/);
    const second = await launchDelegation(options, dependencies);
    assert.equal(second.state, 'unknown');
    assert.equal(count(), 1);
    assert.equal(submissions.filter((r) => r.operation === 'begin').length, 1);
  });
});

test('I-12: Cloudはrequested_modelを運び、実modelをunknownに残す', async () => {
  await fixture(async ({ dependencies, options, submissions }) => {
    const result = await launchDelegation({ ...options, runner: 'cloud' }, dependencies);
    assert.equal(result.state, 'running');
    assert.equal(result.requested_model, 'swe-2-high');
    assert.equal(result.observed_model, 'unknown');
    assert.equal(submissions[0].runner, 'cloud');
    assert.equal(submissions[2].observed_model, 'unknown');
  });
});

test('I-09: begin応答喪失は再送・spawnなし', async () => {
  await fixture(async ({ dependencies, options, submissions, count }) => {
    const submit = dependencies.submitRequest;
    dependencies.submitRequest = async (...args) => {
      const result = await submit(...args);
      if (args[2].operation === 'begin') throw new Error('PRIVATE error');
      return result;
    };
    const result = await launchDelegation(options, dependencies);
    assert.equal(result.state, 'launch_unknown');
    assert.equal(result.exitCode, 4);
    assert.equal(count(), 0);
    assert.equal(submissions.filter((r) => r.operation === 'begin').length, 1);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  });
});

test('I-09: 古い受領・再配送・初回結果の喪失ではspawnなし', async () => {
  for (const patch of [{ first_delivery: false, code: 'already_begun' }, { request_comment_id: 888 }, { activation_id: id(900) }]) {
    await fixture(async ({ dependencies, options, count }) => {
      const wait = dependencies.waitForResult;
      dependencies.waitForResult = async (...args) => {
        const result = await wait(...args);
        return result.code === 'begin_allowed' ? { ...result, ...patch } : result;
      };
      assert.equal((await launchDelegation(options, dependencies)).state, 'launch_unknown');
      assert.equal(count(), 0);
    });
  }
  await fixture(async ({ dependencies, options, count }) => {
    const wait = dependencies.waitForResult;
    dependencies.waitForResult = async (...args) => {
      const result = await wait(...args);
      if (result.code === 'begin_allowed') throw new Error('lost');
      return result;
    };
    assert.equal((await launchDelegation(options, dependencies)).state, 'launch_unknown');
    assert.equal(count(), 0);
  });
});

test('I-10: spentの失敗と作成済みの印はspawnなし。印を消さない', async () => {
  await fixture(async ({ dir, dependencies, options, count }) => {
    reserveSpent(dir, id(1), { attempt_id: attempt });
    assert.throws(() => reserveSpent(dir, id(1), { attempt_id: attempt }));
    assert.equal((await launchDelegation(options, dependencies)).state, 'launch_unknown');
    assert.equal(count(), 0);
    assert.ok(existsSync(join(dir, 'delegation-spent', `${id(1)}.spent`)));
    assert.throws(() => reserveSpent(dir, '../escape', {}));
  });
  await fixture(async ({ dir, dependencies, options, count }) => {
    writeFileSync(join(dir, 'delegation-spent'), 'blocked');
    assert.equal((await launchDelegation(options, dependencies)).state, 'launch_unknown');
    assert.equal(count(), 0);
  });
});

test('I-10/I-11: spawn応答・started保存の喪失でも再起動しない', async () => {
  await fixture(async ({ dependencies, options, count }) => {
    const spawnOnce = dependencies.spawnOnce;
    dependencies.spawnOnce = async (input) => { await spawnOnce(input); throw new Error('lost'); };
    const result = await launchDelegation(options, dependencies);
    assert.equal(result.state, 'launch_unknown');
    assert.equal(count(), 1);
    await launchDelegation(options, dependencies);
    assert.equal(count(), 1);
  });
  await fixture(async ({ dependencies, options, count }) => {
    const submit = dependencies.submitRequest;
    dependencies.submitRequest = async (...args) => { if (args[2].operation === 'started') throw new Error('lost'); return submit(...args); };
    assert.equal((await launchDelegation(options, dependencies)).state, 'launch_unknown');
    assert.equal(count(), 1);
  });
});

test('I-22: 移行/CLI確認前と共有取得不能は起動なし', async () => {
  for (const flag of ['migration_complete', 'cli_launch_verified']) {
    await fixture(async ({ dependencies, options, submissions, count }) => {
      dependencies.config = { ...config, [flag]: false };
      assert.equal((await launchDelegation(options, dependencies)).exitCode, 4);
      assert.equal(count(), 0);
      assert.deepEqual(submissions, []);
    });
  }
  await fixture(async ({ dependencies, options, submissions, count }) => {
    dependencies.readSnapshot = async () => { throw new Error('PRIVATE TOKEN'); };
    const result = await launchDelegation(options, dependencies);
    assert.equal(result.exitCode, 5);
    assert.equal(count(), 0);
    assert.deepEqual(submissions, []);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|TOKEN/);
    assert.equal((await runLaunchCli([], dependencies)).exitCode, 2);
  });
});

test('I-08: 実coreの並行claim/beginは同じattemptへ集まり、spawnは1回以下', async () => {
  const { applyChanges, emptyState, reduceRequest } = await import('../scripts/delegation-shared.mjs');
  await fixture(async ({ dependencies, options, submissions, count }) => {
    let state = emptyState();
    state.tasks['feature:task'] = { task_key: 'feature:task', task_digest: digest, plan_path: 'docs/implementation-plans/feature.md', plan_sha: 'b'.repeat(40), state: 'issue_ready', issue: 81, pr: null, start_conditions_confirmed: true };
    dependencies.readSnapshot = async () => structuredClone(state);
    dependencies.waitForResult = async (_client, _config, { requestId, commentId }) => {
      const { commentId: _comment, ...request } = submissions.find((r) => r.request_id === requestId);
      const reduced = reduceRequest(state, request, { config, now: '2026-10-09T10:00:00Z', attempt_id: attempt, issue_verified: true, session_verified: true });
      state = applyChanges(state, reduced.changes);
      return { ...reduced.result, request_id: requestId, request_comment_id: commentId, source_run_id: 5, source_run_attempt: 1, event_hash: digest };
    };
    const results = await Promise.all([launchDelegation(options, dependencies), launchDelegation(options, dependencies)]);
    assert.equal(count(), 1);
    assert.deepEqual(results.map((r) => r.state).sort(), ['launch_unknown', 'running']);
    assert.equal(state.tasks['feature:task'].attempt_id, attempt);
    assert.equal(state.tasks['feature:task'].state, 'running');
    assert.equal(submissions.filter((r) => r.operation === 'started').length, 1);
  });
});
