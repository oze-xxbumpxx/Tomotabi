import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubClient, GitHubError } from '../scripts/delegation-github.mjs';

const repo = 'oze-xxbumpxx/Tomotabi';
test('通信をシェルに渡さず、JSONと固定APIヘッダーをstdinへ渡す', async () => {
  const calls = [];
  const client = createGitHubClient({ repo, execute: async (call) => { calls.push(call); return 'HTTP/2.0 201 Created\r\ncontent-type: application/json\r\n\r\n{"id":12}'; } });
  assert.deepEqual(await client.rest('POST', '/repos/test/issues', { body: '`$()\n秘密' }), { id: 12 });
  assert.equal(calls[0].args[0], 'api');
  assert.equal(calls[0].input, JSON.stringify({ body: '`$()\n秘密' }));
  assert.equal(client.calls, 1);
  assert.throws(() => createGitHubClient({ repo: 'https://example.test' }), GitHubError);
  await assert.rejects(client.rest('GET', 'https://example.test'), /invalid_request/);
});

test('main履歴のSHA...SHA比較を許可し、パスのdot segmentは拒否する', async () => {
  const paths = [];
  const client = createGitHubClient({ repo, execute: async ({ args }) => { paths.push(args[4]); return { status: 200, data: { status: 'identical' } }; } });
  const path = `/repos/${repo}/compare/${'a'.repeat(40)}...${'b'.repeat(40)}`;
  assert.deepEqual(await client.rest('GET', path), { status: 'identical' });
  assert.equal(paths[0], path.slice(1));
  for (const value of ['../repos/test', 'repos/test/../issues', 'repos/test/./issues', 'repos/test/..', 'repos/test/..?x=1']) await assert.rejects(client.rest('GET', value), /invalid_request/);
  assert.equal(client.calls, 1);
});

test('読み取りだけを1/2/4秒で再試行し、API予算を全試行で数える', async () => {
  const delays = [];
  let attempts = 0;
  const client = createGitHubClient({ repo, sleep: async (ms) => delays.push(ms), execute: async () => {
    attempts += 1;
    return { status: attempts < 4 ? 503 : 200, data: { ok: true } };
  } });
  assert.deepEqual(await client.rest('GET', 'repos/test'), { ok: true });
  assert.deepEqual(delays, [1000, 2000, 4000]);
  assert.equal(client.calls, 4);
});

test('POSTの応答喪失とサーバーエラーは再送せず、raw errorを公開しない', async () => {
  let calls = 0;
  const client = createGitHubClient({ repo, execute: async () => { calls += 1; throw new Error('SECRET_TOKEN RAW_PROMPT'); }, sleep: async () => assert.fail('POSTを再試行した') });
  await assert.rejects(client.rest('POST', 'repos/test/issues', { body: 'x' }), (error) => {
    assert.equal(error.outcome_unknown, true);
    assert.doesNotMatch(error.message, /SECRET|RAW_PROMPT/);
    return true;
  });
  assert.equal(calls, 1);
  const http = createGitHubClient({ repo, execute: async () => ({ status: 500, data: { message: 'SECRET' } }) });
  await assert.rejects(http.rest('POST', 'repos/test'), (error) => error.outcome_unknown === true);
});

test('Retry-Afterは30秒までで、認証拒否は繰り返さない', async () => {
  let calls = 0;
  const delays = [];
  const client = createGitHubClient({ repo, sleep: async (ms) => delays.push(ms), execute: async () => ({ status: ++calls === 1 ? 429 : 200, headers: { 'retry-after': '99' }, data: [] }) });
  await client.rest('GET', 'repos/test');
  assert.deepEqual(delays, [30_000]);
  const denied = createGitHubClient({ repo, execute: async () => ({ status: 401, data: {} }), sleep: async () => assert.fail('認証拒否を再試行した') });
  await assert.rejects(denied.rest('GET', 'repos/test'), /http_failure/);
});

test('全ページを集め、件数・ページ上限や不完全な検索で部分集合を返さない', async () => {
  const client = createGitHubClient({ repo, execute: async ({ args }) => ({ status: 200, data: args[4].includes('page=1') ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }] }) });
  assert.deepEqual(await client.paginate('repos/test/issues', { pageSize: 2, maxItems: 4 }), [{ id: 1 }, { id: 2 }, { id: 3 }]);
  const full = createGitHubClient({ repo, execute: async () => ({ status: 200, data: [1, 2] }) });
  await assert.rejects(full.paginate('repos/test/issues', { pageSize: 2, maxItems: 2 }), /item_limit/);
  await assert.rejects(full.paginate('repos/test/issues', { pageSize: 2, maxPages: 1, maxItems: 10 }), /page_limit/);
  const malformed = createGitHubClient({ repo, execute: async () => ({ status: 200, data: { items: [1], incomplete_results: true } }) });
  await assert.rejects(malformed.paginate('repos/test/search', { key: 'items' }), /pagination_incomplete/);
  await assert.rejects(full.paginate('repos/test', { pageSize: 101 }), /invalid_limit/);
});

test('GraphQLは読み取りだけで、errorsを含む200応答を成功にしない', async () => {
  const client = createGitHubClient({ repo, execute: async ({ input }) => ({ status: 200, data: { data: { repository: { id: JSON.parse(input).variables.id } } } }) });
  assert.deepEqual(await client.graphql('query($id:Int!){repository{id}}', { id: 1 }), { repository: { id: 1 } });
  await assert.rejects(client.graphql('mutation { updateIssue { id } }'), /graphql_write_forbidden/);
  const broken = createGitHubClient({ repo, execute: async () => ({ status: 200, data: { data: {}, errors: [{ message: 'secret' }] } }) });
  await assert.rejects(broken.graphql('{ repository { id } }'), /graphql_incomplete/);
});

test('200回とjob時間の上限を越える前に停止する', async () => {
  const client = createGitHubClient({ repo, maxApiCalls: 200, execute: async () => ({ status: 200, data: [] }) });
  for (let n = 0; n < 200; n += 1) await client.rest('GET', 'repos/test');
  await assert.rejects(client.rest('GET', 'repos/test'), /api_budget/);
  let time = 0;
  const timed = createGitHubClient({ repo, clock: () => time, jobTimeoutMs: 5, execute: async () => ({ status: 200, data: [] }) });
  time = 5;
  await assert.rejects(timed.rest('GET', 'repos/test'), /job_timeout/);
});

test('通知のdownloadは固定APIパス・サイズに限定する', async () => {
  const client = createGitHubClient({ repo, execute: async (call) => {
    assert.equal(call.responseType, 'binary');
    return Buffer.from('zip');
  } });
  assert.equal((await client.downloadArtifact(`/repos/${repo}/actions/artifacts/1/zip`)).toString(), 'zip');
  await assert.rejects(client.downloadArtifact('https://example.test/archive'), /invalid_artifact/);
  await assert.rejects(client.downloadArtifact(`/repos/${repo}/actions/artifacts/1/zip`, { maxBytes: 2 }), /artifact_limit/);
});
