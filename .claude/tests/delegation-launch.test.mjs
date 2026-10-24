import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDevinArgs, consumeBeginReceipt, launchDelegation, observeLocalSession, parseLaunchArgs, readExportSessionId, reserveSpent, runLaunchCli, sessionIdsIn } from '../scripts/delegation-launch.mjs';

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
    const clone = realpathSync(mkdtempSync(join(dir, 'clone-')));
    // 手元の一覧: 起動の前は空、起動のあとはsession-1だけ。
    let sessions = [];
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
      listSessions: async (cwd) => {
        assert.equal(cwd, clone);
        return structuredClone(sessions);
      },
      sleep: async () => {},
      observeMs: 4,
      intervalMs: 2,
      spawnOnce: async (input) => {
        spawnCount += 1;
        sessions = [{ id: 'session-1', working_directory: clone, title: 'PRIVATE TITLE' }];
        assert.ok(existsSync(join(dir, 'delegation-spent', `${id(1)}.spent`)));
        assert.deepEqual(input.args.slice(-2), ['--prompt-file', realpathSync(prompt)]);
        assert.doesNotMatch(JSON.stringify(input.args), /PRIVATE PROMPT/);
        return { session_id: 'session-1', session_url: 'https://app.devin.ai/sessions/session-1', observed_model: 'swe-2-high' };
      },
      ...overrides,
    };
    const options = { taskKey: 'feature:task', callerId: caller, runner: 'local', model: 'swe-2-high', promptFile: prompt, clone };
    await fn({ dir, prompt, clone, dependencies, options, submissions, count: () => spawnCount, setSessions: (value) => { sessions = value; } });
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
  assert.deepEqual(buildDevinArgs({ runner: 'local', model: 'swe-2-high', promptFile: '/p', exportFile: '/e' }), ['--model', 'swe-2-high', '--permission-mode', 'dangerous', '--export', '/e', '-p', '--prompt-file', '/p']);
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
    assert.equal(submissions[2].session_url, null);
    assert.equal(statSync(join(dir, 'delegation-spent', `${id(1)}.spent`)).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, 'devin-logs', 'issue-81.log')).mode & 0o777, 0o600);
    assert.doesNotMatch(JSON.stringify({ result, submissions }), /PRIVATE PROMPT|PRIVATE TITLE|prompt-file/);
    const second = await launchDelegation(options, dependencies);
    assert.equal(second.state, 'unknown');
    assert.equal(count(), 1);
    assert.equal(submissions.filter((r) => r.operation === 'begin').length, 1);
  });
});

test('I-12: Cloudはrequested_modelを運び、実modelをunknownに残す', async () => {
  await fixture(async ({ dependencies, options, submissions }) => {
    dependencies.config = { ...config, cloud_launch_verified: true };
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
    // 並行のclaim/beginの集まり方を見るため、ここでは専用クローンのロックを外す（ロックは別の試験で見る）。
    dependencies.acquireCloneLock = () => () => {};
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

// devin-local-session: 手元のセッションのIDを、起動の前後の一覧の差で決める
const observe = (lists, extra = {}) => {
  let i = 0;
  return observeLocalSession({ before: new Set(['old-1']), clone: '/clone', exportFile: '/no/such/export.json', listSessions: async () => { const next = lists[Math.min(i, lists.length - 1)]; i += 1; if (next instanceof Error) throw next; return next; }, sleep: async () => {}, observeMs: 6, intervalMs: 2, ...extra });
};
const at = (id, dir = '/clone') => ({ id, working_directory: dir });

test('LS-01: 待つ時間いっぱい読み、最後まで新しいIDがちょうど1つのときだけ返す', async () => {
  assert.equal(await observe([[at('old-1')], [at('old-1'), at('new-1')], [at('old-1'), at('new-1')]]), 'new-1');
  assert.equal(await observe([[at('old-1')], [at('old-1')], [at('old-1')]]), null);
});

test('LS-02: 途中で新しいIDが2つ以上になったら、あとで1つに見えても確定しない', async () => {
  assert.equal(await observe([[at('a')], [at('a'), at('b')], [at('a')]]), null);
});

test('LS-03: 別のフォルダのセッションは数えず、一覧を読めない・形が違うときは確定しない', async () => {
  assert.equal(await observe([[at('new-1', '/other')], [at('new-1', '/other')], [at('new-1', '/other')]]), null);
  assert.equal(await observe([[at('new-1')], new Error('PRIVATE'), [at('new-1')]]), null);
  assert.equal(await observe([[at('new-1')], { not: 'array' }, [at('new-1')]]), null);
  assert.equal(await observe([[at('bad id')], [at('bad id')], [at('bad id')]]), null);
  assert.throws(() => sessionIdsIn([{ id: '../x', working_directory: '/clone' }], '/clone'));
});

test('LS-04: 書き出しが出ていれば、そのIDが一覧のIDと違うとき確定しない', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'delegation-export-'));
  try {
    const file = join(dir, 'export.json');
    writeFileSync(file, JSON.stringify({ schema_version: 'ATIF-v1.7', session_id: 'new-1', steps: ['PRIVATE CONVERSATION'] }));
    assert.equal(readExportSessionId(file), 'new-1');
    assert.equal(await observe([[at('new-1')]], { exportFile: file }), 'new-1');
    writeFileSync(file, JSON.stringify({ session_id: 'someone-else' }));
    assert.equal(await observe([[at('new-1')]], { exportFile: file }), null);
    writeFileSync(file, '{not json');
    assert.equal(readExportSessionId(file), null);
    assert.equal(await observe([[at('new-1')]], { exportFile: file }), 'new-1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('LS-05: 起動の前の一覧を読めなければ、共有状態に何も送らず起動しない', async () => {
  await fixture(async ({ dependencies, options, submissions, count }) => {
    dependencies.listSessions = async () => { throw new Error('PRIVATE'); };
    const result = await launchDelegation(options, dependencies);
    assert.equal(result.exitCode, 5);
    assert.deepEqual(submissions, []);
    assert.equal(count(), 0);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  });
});

test('LS-06: 専用クローンのロックがあれば、共有状態に何も送らず起動しない。終わればロックを外す', async () => {
  await fixture(async ({ dir, dependencies, options, submissions, count }) => {
    writeFileSync(join(dir, 'devin-clone.lock'), '{}');
    const blocked = await launchDelegation(options, dependencies);
    assert.equal(blocked.exitCode, 4);
    assert.deepEqual(submissions, []);
    assert.equal(count(), 0);
    rmSync(join(dir, 'devin-clone.lock'));
    assert.equal((await launchDelegation(options, dependencies)).state, 'running');
    assert.equal(existsSync(join(dir, 'devin-clone.lock')), false);
  });
});

test('LS-07: 起動のあとに別のセッションも出たら、IDを空にしてlaunch_unknownにし、起動し直さない', async () => {
  await fixture(async ({ clone, dependencies, options, submissions, count, setSessions }) => {
    const spawnOnce = dependencies.spawnOnce;
    dependencies.spawnOnce = async (input) => {
      const result = await spawnOnce(input);
      setSessions([{ id: 'session-1', working_directory: clone }, { id: 'desktop-app', working_directory: clone }]);
      return result;
    };
    const result = await launchDelegation(options, dependencies);
    assert.equal(result.state, 'launch_unknown');
    assert.equal(count(), 1);
    assert.equal(submissions.at(-1).session_id, null);
  });
});

test('LS-08: 手元の起動は非公開の書き出し先を--exportで渡し、既にあれば起動しない', async () => {
  await fixture(async ({ dir, dependencies, options, count }) => {
    const spawnOnce = dependencies.spawnOnce;
    let exportArg = null;
    dependencies.spawnOnce = async (input) => { exportArg = input.args[input.args.indexOf('--export') + 1]; return spawnOnce(input); };
    await launchDelegation(options, dependencies);
    assert.equal(exportArg, join(dir, 'devin-logs', `export-${id(1)}.json`));
    assert.equal(count(), 1);
  });
  await fixture(async ({ dir, dependencies, options, count }) => {
    mkdirSync(join(dir, 'devin-logs'), { recursive: true });
    writeFileSync(join(dir, 'devin-logs', `export-${id(1)}.json`), '{}');
    assert.equal((await launchDelegation(options, dependencies)).state, 'launch_unknown');
    assert.equal(count(), 0);
  });
});

test('LS-09: クラウドは確認の設定が無ければ、共有状態に何も送らず起動しない', async () => {
  await fixture(async ({ dependencies, options, submissions, count }) => {
    const result = await launchDelegation({ ...options, runner: 'cloud' }, dependencies);
    assert.equal(result.exitCode, 4);
    assert.deepEqual(submissions, []);
    assert.equal(count(), 0);
  });
});
