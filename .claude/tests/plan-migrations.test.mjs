import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { planMigrations, main } from '../../.github/scripts/plan-migrations.mjs';

// 一覧を作るスクリプトの試験（docs/tests/migration-workflow.mdのMW-01〜17）。
const W10 = 1791384966637;
const W11 = 1794122827791;
const W12 = 1794122838776;
const journal = () => ({
  entries: [
    { idx: 10, when: W10, tag: '0010_notification_grants' },
    { idx: 11, when: W11, tag: '0011_planning_todos' },
    { idx: 12, when: W12, tag: '0012_planning_todos_grants' },
  ],
});
const ok = (lastAppliedAt) => ({ status: 200, body: JSON.stringify({ lastAppliedAt }) });

// planMigrationsの判定（MW-01〜06、MW-11）。
test('MW-01: 全部流し済みならnoneで、まとめに「流すものはありません」', async () => {
  const plan = planMigrations(journal(), ok(W12));
  assert.equal(plan.state, 'none');
  assert.equal(plan.count, 0);
  assert.deepEqual(plan.names, []);

  const dir = await mkdtemp(join(tmpdir(), 'mw01-'));
  try {
    const summaryPath = join(dir, 'summary.md');
    const d = deps({ response: ok(W12), summaryPath });
    assert.equal(await main(['https://a.test', 'j'], d.options), 0);
    assert.match(await readFile(summaryPath, 'utf8'), /流すものはありません/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('MW-02: DBの方が新しければnone（E-07）', () => {
  const plan = planMigrations(journal(), ok(W12 + 1));
  assert.equal(plan.state, 'none');
  assert.equal(plan.count, 0);
});

test('MW-03: 1本だけ流していなければpendingで、その名前を出す（F-04）', async () => {
  const plan = planMigrations(journal(), ok(W11));
  assert.equal(plan.state, 'pending');
  assert.equal(plan.count, 1);
  assert.deepEqual(plan.names, ['0012_planning_todos_grants']);

  const dir = await mkdtemp(join(tmpdir(), 'mw03-'));
  try {
    const summaryPath = join(dir, 'summary.md');
    const d = deps({ response: ok(W11), summaryPath });
    assert.equal(await main(['https://a.test', 'j'], d.options), 0);
    assert.match(await readFile(summaryPath, 'utf8'), /0012_planning_todos_grants/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('MW-04: 複数を流す順に出す（F-04）', () => {
  const plan = planMigrations(journal(), ok(W10 - 1));
  assert.equal(plan.state, 'pending');
  assert.equal(plan.count, 3);
  assert.deepEqual(plan.names, [
    '0010_notification_grants',
    '0011_planning_todos',
    '0012_planning_todos_grants',
  ]);
});

test('MW-05: entriesの並びに頼らない', () => {
  const j = journal();
  j.entries.reverse();
  const plan = planMigrations(j, ok(W10));
  assert.equal(plan.state, 'pending');
  assert.deepEqual(plan.names, ['0011_planning_todos', '0012_planning_todos_grants']);
});

test('MW-06: 境目の1つ下ならpending', () => {
  const plan = planMigrations(journal(), ok(W12 - 1));
  assert.equal(plan.state, 'pending');
  assert.equal(plan.count, 1);
  assert.deepEqual(plan.names, ['0012_planning_todos_grants']);
});

test('MW-11: DBに1本も流していなければ止める（B-02）', async () => {
  const plan = planMigrations(journal(), ok(null));
  assert.equal(plan.state, 'stop');

  const dir = await mkdtemp(join(tmpdir(), 'mw11-'));
  try {
    const summaryPath = join(dir, 'summary.md');
    const d = deps({ response: ok(null), summaryPath });
    assert.equal(await main(['https://a.test', 'j'], d.options), 1);
    const summary = await readFile(summaryPath, 'utf8');
    assert.match(summary, /1本も流れていません/);
    assert.match(summary, /端末/);
    assert.match(d.lines[0], /^::error::/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// mainは外とのやりとりを差し替えて試す。
function deps({ response, journalText, summaryPath = null, outputPath = null } = {}) {
  const calls = [];
  const lines = [];
  return {
    calls,
    lines,
    options: {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        if (response instanceof Error) throw response;
        return { status: response.status, text: async () => response.body };
      },
      readFile: async () => {
        if (journalText instanceof Error) throw journalText;
        return journalText ?? JSON.stringify(journal());
      },
      summaryPath,
      outputPath,
      log: (line) => lines.push(line),
      env: {},
    },
  };
}

const withSummary = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), 'mw-'));
  try {
    return await fn(join(dir, 'summary.md'), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

test('MW-07: 口が無い（404）ならunknownで、終了コード0（F-12）', async () => {
  await withSummary(async (summaryPath) => {
    const d = deps({ response: { status: 404, body: 'Not Found' }, summaryPath });
    assert.equal(await main(['https://a.test', 'j'], d.options), 0);
    const summary = await readFile(summaryPath, 'utf8');
    assert.match(summary, /一覧を出せません/);
    assert.match(summary, /確かめの口がまだありません/);
    assert.match(d.lines[0], /^::warning::/);
  });
});

test('MW-08: つながらない・打ち切りならunknownで、終了コード0（F-12）', async () => {
  for (const error of [new TypeError('fetch failed'), new DOMException('timed out', 'TimeoutError')]) {
    const d = deps({ response: error });
    assert.equal(await main(['https://a.test', 'j'], d.options), 0, error.name);
    assert.match(d.lines[0], /^::warning::一覧を出せません/);
  }
});

test('MW-09: 200以外・返す形が違えばunknownで、終了コード0（F-12）', async () => {
  const answers = [
    { status: 500, body: '' },
    { status: 200, body: 'not json' },
    { status: 200, body: '{}' },
    { status: 200, body: '{"lastAppliedAt":"1794122838776"}' },
  ];
  for (const response of answers) {
    const d = deps({ response });
    assert.equal(await main(['https://a.test', 'j'], d.options), 0, JSON.stringify(response));
    assert.match(d.lines[0], /^::warning::一覧を出せません/);
  }
});

test('MW-10: apiのURLが無い・httpsでなければunknownで、理由に変数の名前。apiを呼ばない（F-12）', async () => {
  for (const origin of ['', 'http://api.example.test']) {
    const d = deps({ response: ok(W12) });
    assert.equal(await main([origin, 'j', 'MIGRATE_API_ORIGIN_INTEGRATION'], d.options), 0, origin);
    assert.equal(d.calls.length, 0, origin);
    assert.match(d.lines[0], /MIGRATE_API_ORIGIN_INTEGRATION/);
    assert.match(d.lines[0], /一覧を出せません/);
  }
});

test('MW-12: _journal.jsonが読めない・空なら止め、apiには聞かない', async () => {
  const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
  for (const journalText of [enoent, '{"entries":[]}', 'not json']) {
    const d = deps({ response: ok(W12), journalText });
    assert.equal(await main(['https://a.test', 'j'], d.options), 1, String(journalText));
    assert.equal(d.calls.length, 0);
    assert.match(d.lines[0], /^::error::/);
  }
});

test('MW-13: 出力にstateとcountを書く', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mw13-'));
  try {
    const outputPath = join(dir, 'output');
    const d = deps({ response: ok(W11), outputPath });
    assert.equal(await main(['https://a.test', 'j'], d.options), 0);
    const output = await readFile(outputPath, 'utf8');
    assert.match(output, /^state=pending$/m);
    assert.match(output, /^count=1$/m);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('MW-14: --backup-reminderつきなら確かめの文と手順書の場所を出す。noneでは出さない（F-07）', async () => {
  await withSummary(async (summaryPath) => {
    const pending = deps({ response: ok(W11), summaryPath });
    assert.equal(await main(['https://a.test', 'j', 'VAR', '--backup-reminder'], pending.options), 0);
    const summary = await readFile(summaryPath, 'utf8');
    assert.match(summary, /バックアップを取って戻して照合/);
    assert.match(summary, /docs\/runbooks\/backup-and-restore\.md/);

    const nonePath = join(summaryPath, '..', 'none.md');
    const none = deps({ response: ok(W12), summaryPath: nonePath });
    assert.equal(await main(['https://a.test', 'j', 'VAR', '--backup-reminder'], none.options), 0);
    assert.doesNotMatch(await readFile(nonePath, 'utf8'), /バックアップ/);
  });
});

test('MW-15: 聞く先は口のURLで、10秒の打ち切りつきで1回だけ呼び、まとめにホスト名を出す', async () => {
  // AbortSignal.timeoutに渡す時間を記録して、打ち切りが10秒であることを確かめる。
  const original = AbortSignal.timeout;
  const timeouts = [];
  AbortSignal.timeout = (ms) => {
    timeouts.push(ms);
    return original.call(AbortSignal, ms);
  };
  try {
    await withSummary(async (summaryPath) => {
      for (const origin of ['https://api.example.test', 'https://api.example.test/']) {
        const d = deps({ response: ok(W12), summaryPath });
        await main([origin, 'j'], d.options);
        assert.equal(d.calls.length, 1, origin);
        assert.equal(d.calls[0].url, 'https://api.example.test/api/health/migrations');
        assert.ok(d.calls[0].init.signal instanceof AbortSignal);
      }
      assert.match(await readFile(summaryPath, 'utf8'), /api\.example\.test/);
    });
  } finally {
    AbortSignal.timeout = original;
  }
  assert.deepEqual(timeouts, [10_000, 10_000]);
});

test('MW-16: 引数なしなら使い方を出して1', async () => {
  const d = deps({ response: ok(W12) });
  assert.equal(await main([], d.options), 1);
  assert.match(d.lines[0], /^usage:/);
  assert.equal(d.calls.length, 0);
});

test('MW-17: 比べる関数はcheck-deployed-migrations.mjsのcompareMigrationsを使う', () => {
  const source = readFileSync(new URL('../../.github/scripts/plan-migrations.mjs', import.meta.url), 'utf8');
  assert.match(source, /from '\.\/check-deployed-migrations\.mjs'/);
  assert.match(source, /compareMigrations\(\{ journal, response: answer \}\)/);
});
