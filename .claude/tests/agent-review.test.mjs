import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectReviewSnapshot, evaluateSha, createClaudeCompletion } from '../scripts/agent-review.mjs';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const TIME = '2026-10-09T01:00:00Z';
const LATER = '2026-10-09T02:00:00Z';
const CONFIG = {
  schema_version: 1, repository: 'oze-xxbumpxx/Tomotabi', repository_id: 1359576461,
  actor_ids: { claude: [109064833], codex: 199175422, devin: 158243242 },
  limits: { open_prs: 1000, comments: 1000, reviews: 1000, threads: 1000, thread_comments: 5000, max_pages: 10, page_size: 100 },
};
const actor = (databaseId, type = 'Bot') => ({ __typename: type, databaseId });
const url = (pr, id) => `https://github.com/${CONFIG.repository}/pull/${pr}#${id}`;
const evidence = (id, { pr = 1, author = CONFIG.actor_ids.codex, body = '', ...changes } = {}) => ({ id, url: url(pr, id), body, author: actor(author), editor: null, lastEditedAt: null, createdAt: TIME, updatedAt: TIME, ...changes });
const pull = (number = 1, changes = {}) => ({ number, state: 'open', head: { sha: HEAD, ref: 'devin/task' }, base: { ref: 'main', repo: { id: CONFIG.repository_id } }, user: { id: CONFIG.actor_ids.devin }, draft: false, ...changes });
const formal = (id = 'review-1', options = {}) => evidence(id, { submittedAt: TIME, state: 'COMMENTED', commit: { oid: HEAD }, ...options });
const summary = (sha = HEAD.slice(0, 7), status = '✅ **Completed**') => `<!-- codex-pull-request-review-summary -->\n\n## Codex Review Summary\n\n| Review | Status | Commit | Review trigger |\n| --- | --- | --- | --- |\n| 📝 **Code Review** | ${status} <relative-time datetime="${TIME}">${TIME}</relative-time> | \`${sha}\` | Manual request |\n`;
const thread = (id = 'thread-1', nodes = [evidence('finding-1', { body: '非公開の指摘本文' })], resolved = false) => ({ id, isResolved: resolved, isOutdated: false, nodes });

function fake({ pulls = [pull()], details = {}, commits = [{ sha: HEAD }, { sha: OLD }], before = () => {}, transform = (value) => value } = {}) {
  const calls = [];
  const perPr = (number) => ({ comments: [], reviews: [formal(`review-${number}`, { pr: number })], threads: [], ...details[number] });
  function connection(nodes, cursor, size) {
    const start = cursor === null ? 0 : Number(cursor);
    const end = start + size;
    return { nodes: nodes.slice(start, end), pageInfo: { hasNextPage: end < nodes.length, endCursor: end < nodes.length ? String(end) : null } };
  }
  const client = {
    async paginate(path, opts) {
      calls.push({ kind: 'paginate', path, opts });
      before(calls.at(-1));
      return structuredClone(path.includes('/commits') ? commits : pulls);
    },
    async rest(method, path) {
      calls.push({ kind: 'rest', method, path });
      before(calls.at(-1));
      const short = path.split('/').at(-1);
      const matches = commits.filter(({ sha }) => sha.startsWith(short));
      return matches.length === 1 ? structuredClone(matches[0]) : { sha: 'c'.repeat(40) };
    },
    async graphql(query, variables) {
      calls.push({ kind: 'graphql', query, variables });
      before(calls.at(-1));
      let response;
      if (query.includes('query AgentReviewThreadComments')) {
        const value = Object.keys(details).flatMap((key) => perPr(Number(key)).threads).find(({ id }) => id === variables.id);
        response = { node: { id: value.id, comments: connection(value.nodes, variables.cursor, variables.size) } };
      } else {
        const source = perPr(variables.number);
        const key = query.includes('query AgentReviewComments') ? 'comments' : query.includes('query AgentReviewReviews') ? 'reviews' : 'reviewThreads';
        const nodes = key === 'reviewThreads' ? source.threads.map(({ nodes: children, ...value }) => ({ ...value, comments: connection(children, null, variables.size) })) : source[key];
        response = { repository: { pullRequest: { number: variables.number, headRefOid: pulls.find(({ number }) => number === variables.number).head.sha, [key]: connection(nodes, variables.cursor, variables.size) } } };
      }
      return structuredClone(transform(response, calls.at(-1)));
    },
  };
  return { client, calls, perPr };
}
async function collect(options = {}, config = CONFIG, registeredPrs = []) {
  const transport = fake(options);
  const snapshot = await collectReviewSnapshot(transport.client, config, HEAD, { registeredPrs });
  return { ...transport, snapshot, decision: evaluateSha(snapshot, config) };
}
async function approved({ pulls = [pull()], details = {}, acknowledged = [], verdict = 'merge', config = CONFIG } = {}) {
  const initial = await collect({ pulls, details }, config);
  assert.equal(initial.snapshot.unknown, false);
  const nextDetails = structuredClone(details);
  for (const pr of initial.snapshot.prs.filter(({ target }) => target)) {
    const body = createClaudeCompletion({ pr: pr.pr, headSha: HEAD, codexEvidenceHash: pr.codex_evidence_hash, codexEvidence: [...new Map(pr.codex_completions.map((item) => [item.evidence_id, { id: item.evidence_id, url: item.url }])).values()], acknowledgedFindingIds: acknowledged, verdict, reviewedAt: LATER });
    const row = nextDetails[pr.pr] ??= {};
    row.comments = [...(row.comments ?? []), evidence(`claude-${pr.pr}`, { pr: pr.pr, author: CONFIG.actor_ids.claude[0], body, createdAt: LATER, updatedAt: LATER })];
  }
  return { ...(await collect({ pulls, details: nextDetails }, config)), details: nextDetails };
}

test('現在headのsubmitted完了と新規Claude mergeで成功し、collectorはGitHubに書かない', async () => {
  const result = await approved();
  assert.equal(result.decision.conclusion, 'success');
  assert.deepEqual(result.decision.target_prs, [1]);
  assert.equal(result.decision.check.head_sha, HEAD);
  assert.equal(result.decision.check.name, 'agent-review');
  assert.equal(result.decision.check.status, 'completed');
  assert.equal(result.calls.some((call) => call.method && call.method !== 'GET'), false);
});

test('summary本文を持つPENDINGとDISMISSED formal reviewは完了にならない', async () => {
  for (const [state, submittedAt] of [['PENDING', null], ['DISMISSED', TIME]]) {
    const result = await collect({ details: { 1: { reviews: [formal('formal-summary', { body: summary(), state, submittedAt })] } } });
    assert.equal(result.snapshot.unknown, false);
    assert.deepEqual(result.snapshot.prs[0].codex_completions, []);
    assert.equal(result.decision.conclusion, 'failure');
  }
});

test('対象外PR0/1件にもcontextを出し、対象0件の場合だけsuccessにできる', async () => {
  for (const pulls of [[], [pull(1, { user: { id: 77 }, head: { sha: HEAD, ref: 'feature/test' } })]]) {
    const result = await collect({ pulls });
    assert.equal(result.decision.conclusion, 'success');
    assert.deepEqual(result.decision.target_prs, []);
    assert.equal(result.calls.filter(({ kind }) => kind === 'graphql').length, 0);
  }
});

test('Devin作者、devinブランチ、委譲登録をORで判定し、loginや本文では除外しない', async () => {
  const pulls = [pull(1, { head: { sha: HEAD, ref: 'feature/x' } }), pull(2, { user: { id: 77 } }), pull(3, { user: { id: 77 }, head: { sha: HEAD, ref: 'feature/x' } }), pull(4, { user: { id: 77 }, head: { sha: HEAD, ref: 'feature/y' }, body: '<!-- skip-agent-review -->' })];
  const { snapshot } = await collect({ pulls }, CONFIG, [3]);
  assert.deepEqual(snapshot.prs.map(({ pr, target }) => ({ pr, target })), [{ pr: 1, target: true }, { pr: 2, target: true }, { pr: 3, target: true }, { pr: 4, target: false }]);
  const sticky = await collect({ pulls: [pull(3, { user: { id: 77 }, head: { sha: HEAD, ref: 'renamed' } })] }, CONFIG, { 3: { target: true } });
  assert.equal(sticky.snapshot.prs[0].target, true);
  const human = await collect({ pulls: [pull(4, { user: { id: 77 }, head: { sha: HEAD, ref: 'human' } })] }, CONFIG, { 4: { target: false } });
  assert.equal(human.snapshot.prs[0].target, false);
});

test('同headの対象2件と対象外/別baseを集め、各PR自身の証拠を要求する', async () => {
  const pulls = [pull(2, { base: { ref: 'release', repo: { id: CONFIG.repository_id } } }), pull(1), pull(3, { user: { id: 77 }, head: { sha: HEAD, ref: 'human' } })];
  const all = await approved({ pulls });
  assert.equal(all.decision.conclusion, 'success');
  assert.deepEqual(all.decision.target_prs, [1, 2]);
  const missing = structuredClone(all.details);
  missing[2].comments = [];
  const one = await collect({ pulls, details: missing });
  assert.equal(one.decision.conclusion, 'failure');
  assert.notEqual(one.snapshot.snapshot_hash, all.snapshot.snapshot_hash);
});

test('Draft対象を含むSHAはin_progress、別headのPRはそのSHA判定に混ぜない', async () => {
  const result = await collect({ pulls: [pull(1, { draft: true }), pull(2, { head: { sha: OLD, ref: 'devin/old' } })] });
  assert.equal(result.decision.status, 'in_progress');
  assert.equal(result.decision.conclusion, null);
  assert.equal(Object.hasOwn(result.decision.check, 'conclusion'), false);
  assert.deepEqual(result.snapshot.prs.map(({ pr }) => pr), [1]);
});

test('固定botのsummary自編集と短縮SHAを実際の表形式で照合する', async () => {
  const comment = evidence('summary', { body: summary(), editor: actor(CONFIG.actor_ids.codex), lastEditedAt: LATER, updatedAt: LATER });
  const result = await approved({ details: { 1: { reviews: [], comments: [comment] } } });
  assert.equal(result.decision.conclusion, 'success');
  assert.equal(result.snapshot.prs[0].codex_completions[0].commit_sha, HEAD);
  assert.equal(result.calls.filter(({ kind }) => kind === 'rest').length, 1);
});

test('summaryの完全SHAもPR内のコミットであることを確認する', async () => {
  const good = await collect({ details: { 1: { reviews: [], comments: [evidence('summary', { body: summary(HEAD) })] } } });
  assert.equal(good.snapshot.unknown, false);
  assert.equal(good.calls.some(({ kind }) => kind === 'rest'), false);
  const bad = await collect({ details: { 1: { reviews: [], comments: [evidence('summary', { body: summary('c'.repeat(40)) })] } } });
  assert.equal(bad.snapshot.unknown, true);
  assert.notEqual(bad.decision.conclusion, 'success');
});

test('RESTページサイズをtransportのoptsへ一度だけ渡す', async () => {
  const config = { ...CONFIG, limits: { ...CONFIG.limits, page_size: 50 } };
  const result = await collect({ details: { 1: { reviews: [], comments: [evidence('summary', { body: summary() })] } } }, config);
  assert.equal(result.snapshot.unknown, false);
  const calls = result.calls.filter(({ kind }) => kind === 'paginate');
  assert.equal(calls.length, 2);
  assert.equal(calls.every(({ path, opts }) => !path.includes('per_page') && opts.pageSize === 50), true);
});

test('短縮値の曖昧さ、取得失敗、解決不一致ではunknownにする', async () => {
  const comments = [evidence('summary', { body: summary() })];
  const ambiguous = await collect({ details: { 1: { comments, reviews: [] } }, commits: [{ sha: HEAD }, { sha: 'aaaaaaab'.padEnd(40, 'b') }] });
  assert.equal(ambiguous.snapshot.unknown, true);
  for (const before of [(call) => { if (call.kind === 'rest') throw new Error('private-token'); }, () => {}]) {
    const transport = fake({ details: { 1: { comments, reviews: [] } }, before });
    if (before.toString() === '() => {}') transport.client.rest = async () => ({ sha: OLD });
    const snapshot = await collectReviewSnapshot(transport.client, CONFIG, HEAD);
    assert.equal(snapshot.unknown, true);
    assert.doesNotMatch(JSON.stringify(snapshot), /private-token/);
  }
});

test('未submitted、開始の目、依頼、引用の印はCodex完了でない', async () => {
  for (const body of ['👀', '@codex review', `> ${summary()}`, `\`\`\`\n${summary()}\n\`\`\``]) {
    const { snapshot, decision } = await collect({ details: { 1: { reviews: [formal('pending', { state: 'PENDING', submittedAt: null })], comments: [evidence('note', { body })] } } });
    assert.equal(snapshot.prs[0].codex_completions.length, 0);
    assert.equal(decision.conclusion, 'failure');
  }
});

test('summary形式変更と未知の状態を成功にせず、認識したpending表は完了0件', async () => {
  for (const body of [summary().replace('| Commit |', '| SHA |'), summary().replace('Completed', 'Finished'), summary().replace('`aaaaaaa`', '`zzzzzzz`')]) {
    const result = await collect({ details: { 1: { reviews: [], comments: [evidence('summary', { body })] } } });
    assert.equal(result.snapshot.unknown, true);
    assert.notEqual(result.decision.conclusion, 'success');
  }
  const result = await collect({ details: { 1: { reviews: [], comments: [evidence('summary', { body: summary(HEAD, '⏳ **Pending**') })] } } });
  assert.equal(result.snapshot.unknown, false);
  assert.equal(result.snapshot.prs[0].codex_completions.length, 0);
});

test('古いheadの完了、dismiss済みformal review、偽作者だけでは現在headを完了にしない', async () => {
  for (const review of [formal('old', { commit: { oid: OLD } }), formal('dismissed', { state: 'DISMISSED' }), formal('fake', { author: 77 })]) {
    const result = await collect({ details: { 1: { reviews: [review] } } });
    assert.equal(result.snapshot.prs[0].codex_completions.length, 0);
    assert.equal(result.decision.conclusion, 'failure');
  }
});

test('Claude本人/他者の編集は無効で、新規の完了投稿が必要', async () => {
  const good = await approved();
  for (const editor of [CONFIG.actor_ids.claude[0], 77]) {
    const details = structuredClone(good.details);
    Object.assign(details[1].comments.at(-1), { editor: actor(editor, 'User'), lastEditedAt: LATER });
    const invalid = await collect({ details });
    assert.equal(invalid.decision.conclusion, 'failure');
    details[1].comments.push({ ...good.details[1].comments.at(-1), id: 'claude-new', url: url(1, 'claude-new'), createdAt: '2026-10-09T03:00:00Z', updatedAt: '2026-10-09T03:00:00Z' });
    assert.equal((await collect({ details })).decision.conclusion, 'success');
  }
});

test('Claudeは最新の現在headの投稿を選び、fix/escalateや未投稿reviewを採用しない', async () => {
  for (const verdict of ['fix', 'escalate']) assert.equal((await approved({ verdict })).decision.conclusion, 'failure');
  const good = await approved();
  const details = structuredClone(good.details);
  const body = details[1].comments.at(-1).body.replace('"verdict": "merge"', '"verdict": "fix"');
  details[1].comments.push(evidence('later', { author: CONFIG.actor_ids.claude[0], body, createdAt: '2026-10-09T03:00:00Z' }));
  assert.equal((await collect({ details })).decision.conclusion, 'failure');
  details[1].comments = [];
  details[1].reviews = [formal(), formal('claude-review', { author: CONFIG.actor_ids.claude[0], body: good.details[1].comments[0].body, state: 'PENDING', submittedAt: null })];
  assert.equal((await collect({ details })).decision.conclusion, 'failure');
  details[1].reviews[1].state = 'DISMISSED';
  details[1].reviews[1].submittedAt = TIME;
  assert.equal((await collect({ details })).decision.conclusion, 'failure');
});

test('Claudeの旧形式、短縮SHA、引用、別PR、別head、別hash、欠落欄は成功にしない', async () => {
  const good = await approved();
  const raw = good.details[1].comments[0].body;
  for (const body of ['<!-- claude-review verdict=merge -->', `> ${raw}`, `\`\`\`\n${raw}\n\`\`\``, raw.replace(HEAD, HEAD.slice(0, 7)), raw.replace('"pr": 1', '"pr": 2'), raw.replace(HEAD, OLD), raw.replace(/"codex_evidence_hash": "[a-f0-9]+"/, `"codex_evidence_hash": "${'c'.repeat(64)}"`), raw.replace(/\s*"reviewed_at": "[^"]+"/, '')]) {
    const details = { 1: { comments: [evidence('claude', { author: CONFIG.actor_ids.claude[0], body })] } };
    assert.notEqual((await collect({ details })).decision.conclusion, 'success');
  }
});

test('Codex他者編集、非User/Bot、編集情報欠落/不整合はunknown', async () => {
  const changes = [{ editor: actor(77), lastEditedAt: LATER }, { author: actor(CONFIG.actor_ids.codex, 'Organization') }, { editor: actor(CONFIG.actor_ids.codex), lastEditedAt: null }, { lastEditedAt: 'yesterday' }];
  for (const patch of changes) {
    const result = await collect({ details: { 1: { reviews: [formal('invalid', patch)] } } });
    assert.equal(result.snapshot.unknown, true);
    assert.notEqual(result.decision.conclusion, 'success');
  }
  for (const field of ['editor', 'lastEditedAt', 'updatedAt']) {
    const review = formal();
    delete review[field];
    assert.equal((await collect({ details: { 1: { reviews: [review] } } })).snapshot.unknown, true);
  }
});

test('古い/outdatedの未解決スレッドも解決が必要で、行外指摘のID全件を確認する', async () => {
  const old = thread('old', [evidence('old-finding', { body: 'old private finding' })]);
  old.isOutdated = true;
  const unresolved = await approved({ details: { 1: { threads: [old] } } });
  assert.equal(unresolved.decision.conclusion, 'failure');
  old.isResolved = true;
  const details = { 1: { threads: [old], comments: [evidence('outside-1', { body: 'private finding one' }), evidence('outside-2', { body: 'private finding two' })] } };
  assert.equal((await approved({ details, acknowledged: ['outside-1'] })).decision.conclusion, 'failure');
  const all = await approved({ details, acknowledged: ['outside-1', 'outside-2'] });
  assert.equal(all.decision.conclusion, 'success');
  assert.doesNotMatch(JSON.stringify(all.snapshot), /private finding|old private/);
  assert.doesNotMatch(JSON.stringify(all.decision), /private finding|old private/);
});

test('Claude完了後のCodex指摘追加/編集/再開/削除/dismissでhashと成功が変わる', async () => {
  const good = await approved({ details: { 1: { threads: [thread('thread', [evidence('finding', { body: 'private text' })], true)] } } });
  for (const mutate of [
    (details) => details[1].threads.push(thread('new', [evidence('new-finding', { body: 'new private text' })], true)),
    (details) => Object.assign(details[1].threads[0].nodes[0], { body: 'edited private text', editor: actor(CONFIG.actor_ids.codex), lastEditedAt: LATER, updatedAt: LATER }),
    (details) => { details[1].threads[0].isResolved = false; },
    (details) => { details[1].threads = []; },
    (details) => { details[1].reviews = [formal('review-1', { state: 'DISMISSED' })]; },
  ]) {
    const details = structuredClone(good.details);
    mutate(details);
    const changed = await collect({ details });
    assert.notEqual(changed.snapshot.snapshot_hash, good.snapshot.snapshot_hash);
    assert.notEqual(changed.snapshot.prs[0].codex_evidence_hash, good.snapshot.prs[0].codex_evidence_hash);
    assert.notEqual(changed.decision.conclusion, 'success');
  }
});

test('旧headのformal reviewにもstate/submitted/commitを保持し、dismissでhashを変える', async () => {
  for (const body of ['', '旧headの非公開行外指摘']) {
    const details = { 1: { reviews: [formal('review-1'), formal('old-review', { body, commit: { oid: OLD } })] } };
    const good = await approved({ details, acknowledged: body === '' ? [] : ['old-review'] });
    assert.equal(good.decision.conclusion, 'success');
    assert.deepEqual(good.snapshot.prs[0].codex_review_evidence.find(({ id }) => id === 'old-review').commit_sha, OLD);
    const changed = structuredClone(good.details);
    changed[1].reviews[1].state = 'DISMISSED';
    const after = await collect({ details: changed });
    assert.notEqual(after.snapshot.prs[0].codex_evidence_hash, good.snapshot.prs[0].codex_evidence_hash);
    assert.notEqual(after.snapshot.snapshot_hash, good.snapshot.snapshot_hash);
    assert.equal(after.decision.conclusion, 'failure');
    if (body !== '') {
      const finding = after.snapshot.prs[0].codex_findings.find(({ id }) => id === 'old-review');
      assert.equal(finding.state, 'DISMISSED');
      assert.equal(finding.submitted_at, TIME);
      assert.equal(finding.commit_sha, OLD);
    }
  }
});

test('証拠の取得順だけを変えてもhashが安定し、code fence内のsummary表は採用しない', async () => {
  const details = { 1: { reviews: [formal('Z'), formal('a')], comments: [evidence('z', { body: 'private z' }), evidence('A', { body: 'private A' })], threads: [thread('Z', [evidence('T')], true), thread('a', [evidence('t')], true)] } };
  const first = await collect({ details });
  const reordered = structuredClone(details);
  reordered[1].reviews.reverse();
  reordered[1].comments.reverse();
  reordered[1].threads.reverse();
  const second = await collect({ details: reordered });
  assert.equal(first.snapshot.prs[0].codex_evidence_hash, second.snapshot.prs[0].codex_evidence_hash);
  assert.equal(first.snapshot.snapshot_hash, second.snapshot.snapshot_hash);
  const body = summary().replace('## Codex Review Summary', '```markdown\n## Codex Review Summary') + '\n```';
  const quoted = await collect({ details: { 1: { reviews: [], comments: [evidence('summary', { body })] } } });
  assert.equal(quoted.snapshot.unknown, true);
  assert.notEqual(quoted.decision.conclusion, 'success');
});

test('全ページとスレッド内の続きから101件目の指摘を読む', async () => {
  const humans = Array.from({ length: 100 }, (_, index) => evidence(`human-${index}`, { author: 77 }));
  const details = { 1: { comments: [...humans, evidence('outside-last', { body: 'private last outside' })], threads: [thread('thread', [...humans, evidence('inside-last', { body: 'private last inside' })], true)] } };
  const result = await collect({ details });
  assert.equal(result.snapshot.unknown, false);
  assert.deepEqual(result.snapshot.prs[0].codex_findings.map(({ id }) => id), ['inside-last', 'outside-last']);
  assert.equal(result.calls.some(({ query, variables }) => query?.includes('AgentReviewThreadComments') && variables.cursor === '100'), true);
  assert.equal(result.calls.some(({ query, variables }) => query?.includes('AgentReviewComments') && variables.cursor === '100'), true);
});

test('PRコメント/review/thread/スレッド内コメントの上限到達はunknown', async () => {
  for (const kind of ['comments', 'reviews', 'threads', 'thread_comments']) {
    const config = { ...CONFIG, limits: { ...CONFIG.limits, [kind]: 3, page_size: 2 } };
    const details = { 1: {} };
    if (kind === 'comments') details[1].comments = [0, 1, 2].map((id) => evidence(`comment-${id}`, { author: 77 }));
    if (kind === 'reviews') details[1].reviews = [0, 1, 2].map((id) => formal(`review-${id}`));
    if (kind === 'threads') details[1].threads = [0, 1, 2].map((id) => thread(`thread-${id}`, [], true));
    if (kind === 'thread_comments') details[1].threads = [thread('thread', [0, 1, 2].map((id) => evidence(`finding-${id}`)), true)];
    const result = await collect({ details }, config);
    assert.equal(result.snapshot.unknown, true, kind);
    assert.notEqual(result.decision.conclusion, 'success', kind);
  }
});

test('全スレッド内コメントの合計上限とOPEN PR上限もunknown', async () => {
  const config = { ...CONFIG, limits: { ...CONFIG.limits, thread_comments: 3 } };
  const result = await collect({ details: { 1: { threads: [thread('one', [evidence('a'), evidence('b')], true), thread('two', [evidence('c')], true)] } } }, config);
  assert.equal(result.snapshot.unknown, true);
  assert.equal((await collect({ pulls: [pull(1), pull(2), pull(3)] }, { ...CONFIG, limits: { ...CONFIG.limits, open_prs: 3 } })).snapshot.unknown, true);
});

test('途中ページの失敗、欠落、cursorループ、重複IDを部分成功にしない', async () => {
  const details = { 1: { comments: [evidence('a', { author: 77 }), evidence('b', { author: 77 }), evidence('c', { author: 77 })] } };
  const config = { ...CONFIG, limits: { ...CONFIG.limits, page_size: 2 } };
  const failure = await collect({ details, before: ({ variables }) => { if (variables?.cursor === '2') throw new Error('secret-api-error'); } }, config);
  assert.equal(failure.snapshot.unknown, true);
  assert.doesNotMatch(JSON.stringify(failure.snapshot), /secret-api-error/);
  for (const transform of [(response) => { delete response.repository.pullRequest.comments?.pageInfo; return response; }, (response) => { if (response.repository.pullRequest.comments) response.repository.pullRequest.comments.pageInfo = { hasNextPage: true, endCursor: '0' }; return response; }]) {
    assert.equal((await collect({ details, transform }, config)).snapshot.unknown, true);
  }
  details[1].comments[2].id = 'a';
  assert.equal((await collect({ details }, config)).snapshot.unknown, true);
});

test('対象PRの所属、head変化、OPEN集合取得失敗とGraphQL errorsを成功にしない', async () => {
  const wrongRepo = pull(1, { base: { ref: 'main', repo: { id: 99 } } });
  assert.equal((await collect({ pulls: [wrongRepo] })).snapshot.unknown, true);
  assert.equal((await collect({ pulls: [pull(1, { state: 'closed' })] })).snapshot.unknown, true);
  assert.equal((await collect({ before: ({ kind }) => { if (kind === 'paginate') throw new Error('down'); } })).snapshot.unknown, true);
  assert.equal((await collect({ transform: () => ({ errors: [{ message: 'private error' }] }) })).snapshot.unknown, true);
  const changed = await collect({ transform: (response) => { response.repository.pullRequest.headRefOid = OLD; return response; } });
  assert.equal(changed.snapshot.unknown, true);
});

test('OPEN PR追加/削除/別base/head移動と証拠編集者変更は比較hashを変える', async () => {
  const base = await collect();
  for (const pulls of [[], [pull(), pull(2)], [pull(1, { base: { ref: 'release', repo: { id: CONFIG.repository_id } } })], [pull(1, { head: { sha: OLD, ref: 'devin/task' } })]]) assert.notEqual((await collect({ pulls })).snapshot.snapshot_hash, base.snapshot.snapshot_hash);
  const edited = await collect({ details: { 1: { reviews: [formal('review-1', { editor: actor(CONFIG.actor_ids.codex), lastEditedAt: LATER, updatedAt: LATER })] } } });
  assert.notEqual(edited.snapshot.snapshot_hash, base.snapshot.snapshot_hash);
});

test('JSON入力とsnapshotの防御性、不正config/head/hashでは成功しない', async () => {
  const { snapshot } = await approved();
  const before = structuredClone(snapshot);
  Object.freeze(snapshot);
  evaluateSha(snapshot, CONFIG);
  assert.deepEqual(snapshot, before);
  const tampered = structuredClone(snapshot);
  tampered.prs[0].codex_findings = [];
  tampered.snapshot_hash = 'f'.repeat(64);
  assert.equal(evaluateSha(tampered, CONFIG).conclusion, 'failure');
  assert.equal(evaluateSha(null, null).conclusion, 'failure');
  for (const config of [null, { ...CONFIG, schema_version: 2 }, { ...CONFIG, actor_ids: { ...CONFIG.actor_ids, claude: [] } }]) {
    const transport = fake();
    assert.equal((await collectReviewSnapshot(transport.client, config, HEAD)).unknown, true);
    assert.equal(transport.calls.length, 0);
  }
  const transport = fake();
  assert.equal((await collectReviewSnapshot(transport.client, CONFIG, 'aaaaaaa')).unknown, true);
  assert.equal(transport.calls.length, 0);
});

test('完了JSON生成は正規化し、空/不正値・重複ID・非GitHub URLを拒否する', () => {
  const input = { pr: 1, headSha: HEAD, codexEvidenceHash: 'c'.repeat(64), codexEvidence: [{ id: 'z', url: url(1, 'z') }, { id: 'a', url: url(1, 'a') }], acknowledgedFindingIds: ['b', 'a'], reviewedAt: TIME };
  const original = structuredClone(input);
  const body = createClaudeCompletion(input);
  const value = JSON.parse(body.split('\n').slice(2, -1).join('\n'));
  assert.deepEqual(value.codex_evidence.map(({ id }) => id), ['a', 'z']);
  assert.deepEqual(value.acknowledged_finding_ids, ['a', 'b']);
  assert.deepEqual(input, original);
  assert.equal(value.head_sha, HEAD);
  for (const patch of [{ pr: 0 }, { headSha: 'aaaaaaa' }, { codexEvidenceHash: '' }, { codexEvidence: [] }, { verdict: 'ok' }, { reviewedAt: 'yesterday' }, { acknowledgedFindingIds: ['a', 'a'] }, { codexEvidence: [{ id: 'a', url: 'https://evil.test/secret' }] }, { codexEvidence: [input.codexEvidence[0], input.codexEvidence[0]] }]) assert.throws(() => createClaudeCompletion({ ...input, ...patch }), /completion_invalid/);
});

test('completion CLIはstdoutへの生成だけで、引数/不正入力はexit 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-review-test-'));
  try {
    const path = join(dir, 'input.json');
    writeFileSync(path, JSON.stringify({ pr: 1, headSha: HEAD, codexEvidenceHash: 'c'.repeat(64), codexEvidence: [{ id: 'review', url: url(1, 'review') }], reviewedAt: TIME }));
    const run = (args) => spawnSync(process.execPath, ['.claude/scripts/agent-review.mjs', ...args], { encoding: 'utf8' });
    const result = run(['completion', '--input', path]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^<!-- tomotabi-claude-review -->/);
    assert.equal(result.stderr, '');
    assert.equal(run(['post', '--input', path]).status, 2);
    writeFileSync(path, 'private invalid JSON');
    const invalid = run(['completion', '--input', path]);
    assert.equal(invalid.status, 2);
    assert.doesNotMatch(invalid.stderr, /private invalid/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
