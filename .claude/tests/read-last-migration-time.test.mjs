import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../.github/scripts/read-last-migration-time.mjs';

// 時刻を読むスクリプトの試験（docs/tests/migration-workflow.mdのMW-34〜36）。
// pgはconnectを差し替えて試す。本物のDBにはつながない。
const URL = 'postgres://migrator:s3cret@db.example.test:5432/app';

function deps({ env = { MIGRATION_DATABASE_URL: URL }, connect, client } = {}) {
  const out = [];
  const err = [];
  const calls = [];
  const realConnect =
    connect ??
    (async () =>
      client ?? {
        query: async () => ({ rows: [{ last: '1794122838776' }] }),
        end: async () => {},
      });
  return {
    out,
    err,
    calls,
    options: {
      env,
      connect: async (url) => {
        calls.push(url);
        return realConnect(url);
      },
      log: (line) => out.push(line),
      error: (line) => err.push(line),
    },
  };
}

test('MW-34: max(created_at)の数だけを標準出力に出す', async () => {
  const queries = [];
  const d = deps({
    client: {
      query: async (sql) => {
        queries.push(sql);
        return { rows: [{ last: '1794122838776' }] };
      },
      end: async () => {},
    },
  });
  assert.equal(await main(d.options), 0);
  assert.deepEqual(d.out, ['1794122838776']);
  assert.deepEqual(d.calls, [URL]);
  assert.match(queries[0], /drizzle\.__drizzle_migrations/);
  assert.match(queries[0], /max\(created_at\)/);
});

test('MW-35: 失敗したら元のエラーの文字列を出さず、決まった文だけを出して1', async () => {
  const secretish = 'connect ECONNREFUSED postgres://migrator:s3cret@db.example.test:5432/app';
  for (const connect of [
    async () => {
      throw new Error(secretish);
    },
    async () => ({
      query: async () => {
        throw new Error(secretish);
      },
      end: async () => {},
    }),
  ]) {
    const d = deps({ connect });
    assert.equal(await main(d.options), 1);
    assert.deepEqual(d.out, []);
    assert.deepEqual(d.err, ['DBにつながりませんでした']);
    const shown = [...d.out, ...d.err].join('\n');
    for (const leak of ['ECONNREFUSED', 'db.example.test', 'migrator', 's3cret', 'postgres://']) {
      assert.ok(!shown.includes(leak), `${leak}が出ていない`);
    }
  }
});

test('MW-36: MIGRATION_DATABASE_URLが無ければ接続せず1', async () => {
  for (const env of [{}, { MIGRATION_DATABASE_URL: '' }, { MIGRATION_DATABASE_URL: '   ' }]) {
    const d = deps({ env });
    assert.equal(await main(d.options), 1, JSON.stringify(env));
    assert.equal(d.calls.length, 0);
    assert.deepEqual(d.out, []);
    assert.deepEqual(d.err, ['MIGRATION_DATABASE_URLが設定されていません']);
  }
});
