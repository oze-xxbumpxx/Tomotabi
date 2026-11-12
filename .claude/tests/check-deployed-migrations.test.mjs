import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareMigrations, lastJournalEntry, main } from '../../.github/scripts/check-deployed-migrations.mjs';

// 確かめるスクリプトの試験（docs/tests/migration-deploy-check.md のMD-10〜29）。
const SCRIPT = fileURLToPath(new URL('../../.github/scripts/check-deployed-migrations.mjs', import.meta.url));

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
const compare = (response, j = journal()) => compareMigrations({ journal: j, response });

test('MD-10: DBとcommitの最後が同じなら通す', () => {
  const outcome = compare(ok(W12));
  assert.equal(outcome.result, 'pass');
  assert.deepEqual(outcome.missing, []);
});

test('MD-11: DBの方が新しければ通す', () => {
  assert.equal(compare(ok(W12 + 1)).result, 'pass');
});

test('MD-12: 1本足りなければ止め、その名前を出す', () => {
  const outcome = compare(ok(W11));
  assert.equal(outcome.result, 'fail');
  assert.deepEqual(outcome.missing, ['0012_planning_todos_grants']);
});

test('MD-13: 足りないものを全部出し、案内の1文を出す', () => {
  const outcome = compare(ok(W10));
  assert.equal(outcome.result, 'fail');
  assert.deepEqual(outcome.missing, ['0011_planning_todos', '0012_planning_todos_grants']);
  assert.equal(
    outcome.message,
    'DBに流していないmigrationがあります: 0011_planning_todos, 0012_planning_todos_grants。管理者の端末でmigrationを流してから、もう一度出してください（docs/runbooks/production.md の10章）',
  );
});

test('MD-14: DBに1本も流していなければ止め、全部を出す', () => {
  const outcome = compare(ok(null));
  assert.equal(outcome.result, 'fail');
  assert.deepEqual(outcome.missing, ['0010_notification_grants', '0011_planning_todos', '0012_planning_todos_grants']);
});

test('MD-15: DBがcommitの最後の1つ下なら止める', () => {
  const outcome = compare(ok(W12 - 1));
  assert.equal(outcome.result, 'fail');
  assert.deepEqual(outcome.missing, ['0012_planning_todos_grants']);
});

test('MD-16: 口が無い（404）なら警告して通す', () => {
  assert.equal(compare({ status: 404, body: 'Not Found' }).result, 'warn');
});

test('MD-17: 404以外のエラーは止める', () => {
  for (const status of [500, 401, 302]) {
    assert.equal(compare({ status, body: '' }).result, 'fail', String(status));
  }
});

test('MD-18: つながらなければ止める', () => {
  assert.equal(compare({ error: new TypeError('fetch failed') }).result, 'fail');
});

test('MD-19: 打ち切りなら止める', () => {
  const outcome = compare({ error: new DOMException('timed out', 'TimeoutError') });
  assert.equal(outcome.result, 'fail');
  assert.match(outcome.message, /10秒/);
});

test('MD-20: 返す形が違えば止める', () => {
  const bodies = ['<html>', '{}', '{"lastAppliedAt":"1794122838776"}', '{"lastAppliedAt":1.5}', '[]', 'null'];
  for (const body of bodies) {
    assert.equal(compare({ status: 200, body }).result, 'fail', body);
  }
});

test('MD-22: _journal.jsonが空なら止める', () => {
  for (const j of [{ entries: [] }, {}, null]) {
    assert.equal(compare(ok(W12), j).result, 'fail', JSON.stringify(j));
  }
  assert.throws(() => lastJournalEntry({ entries: [] }));
  assert.throws(() => lastJournalEntry({ entries: [{ when: '1', tag: 'x' }] }));
});

test('MD-23: entriesの並び順に頼らない', () => {
  const j = journal();
  j.entries.reverse();
  assert.equal(lastJournalEntry(j).tag, '0012_planning_todos_grants');
  const outcome = compare(ok(W11), j);
  assert.equal(outcome.result, 'fail');
  assert.deepEqual(outcome.missing, ['0012_planning_todos_grants']);
});

// main は外とのやりとりを差し替えて試す。
function deps({ response, journalText = JSON.stringify(journal()), summaryPath = null } = {}) {
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
        return journalText;
      },
      summaryPath,
      log: (line) => lines.push(line),
    },
  };
}

test('MD-21: _journal.jsonが読めなければ止め、apiには聞かない', async () => {
  const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
  const d = deps({ response: ok(W12), journalText: enoent });
  assert.equal(await main(['https://api.example.test', 'x.json'], d.options), 1);
  assert.equal(d.calls.length, 0);
  const empty = deps({ response: ok(W12), journalText: 'not json' });
  assert.equal(await main(['https://api.example.test', 'x.json'], empty.options), 1);
  assert.equal(empty.calls.length, 0);
});

test('MD-24: 終了コードは通す・警告で0、止めるで1', async () => {
  assert.equal(await main(['https://a.test', 'j'], deps({ response: ok(W12) }).options), 0);
  assert.equal(await main(['https://a.test', 'j'], deps({ response: { status: 404, body: '' } }).options), 0);
  assert.equal(await main(['https://a.test', 'j'], deps({ response: ok(W11) }).options), 1);
});

test('MD-25: 聞く先は口のURLで、1回だけ・打ち切りつきで聞く', async () => {
  for (const origin of ['https://api.example.test', 'https://api.example.test/']) {
    const d = deps({ response: { status: 500, body: '' } });
    await main([origin, 'j'], d.options);
    assert.equal(d.calls.length, 1, origin);
    assert.equal(d.calls[0].url, 'https://api.example.test/api/health/migrations');
    assert.ok(d.calls[0].init.signal instanceof AbortSignal);
  }
});

test('MD-26: 記録に2つの時刻と足りない名前を書き、止めるはerror・警告はwarning', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'md26-'));
  try {
    const summaryPath = join(dir, 'summary.md');
    const d = deps({ response: ok(W10), summaryPath });
    assert.equal(await main(['https://a.test', 'j'], d.options), 1);
    const summary = await readFile(summaryPath, 'utf8');
    assert.match(summary, new RegExp(`DBの最後のmigrationの時刻: ${W10}`));
    assert.match(summary, new RegExp(`出すcommitの最後のmigrationの時刻: ${W12}`));
    assert.match(summary, /足りないmigration: 0011_planning_todos, 0012_planning_todos_grants/);
    assert.match(d.lines[0], /^::error::/);

    const warn = deps({ response: { status: 404, body: '' } });
    await main(['https://a.test', 'j'], warn.options);
    assert.match(warn.lines[0], /^::warning::/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('MD-27: 出すcommitの作業ツリーに依らず、_journal.jsonのパスだけで動く', async () => {
  // 本体が動かない（import.meta.mainが偽になる）と、何もせず0で終わり、確かめずに通ってしまう。
  // 通す場合の出力と、止める場合の終了コードの両方を見て、本体が動いたことを確かめる。
  const dir = await mkdtemp(join(tmpdir(), 'md27-'));
  let lastAppliedAt = W12;
  const server = createServer((req, res) => {
    if (req.url === '/api/health/migrations') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ lastAppliedAt }));
      return;
    }
    res.writeHead(404).end();
  });
  const run = (origin, journalPath) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [SCRIPT, origin, journalPath], {
        cwd: dir,
        env: { ...process.env, GITHUB_STEP_SUMMARY: '' },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let stdout = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.on('error', reject);
      child.on('exit', (code) => resolve({ code, stdout }));
    });
  try {
    const journalPath = join(dir, '_journal.json');
    await writeFile(journalPath, JSON.stringify(journal()));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;

    const passed = await run(origin, journalPath);
    assert.equal(passed.code, 0);
    assert.match(passed.stdout, /^::notice::/m);

    lastAppliedAt = W11;
    const stopped = await run(origin, journalPath);
    assert.equal(stopped.code, 1);
    assert.match(stopped.stdout, /^::error::DBに流していないmigrationがあります: 0012_planning_todos_grants/m);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('MD-28: 引数が足りなければ使い方を出して1', async () => {
  for (const argv of [[], ['https://a.test']]) {
    const d = deps({ response: ok(W12) });
    assert.equal(await main(argv, d.options), 1);
    assert.match(d.lines[0], /^usage:/);
    assert.equal(d.calls.length, 0);
  }
});

test('MD-29: importしただけでは動かない', () => {
  // このファイルが上でimportした時点で本体が動いていれば、exitCodeが変わっている。
  assert.ok(process.exitCode === undefined || process.exitCode === 0);
});
