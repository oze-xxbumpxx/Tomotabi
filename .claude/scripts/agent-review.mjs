#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CLAUDE_MARKER = '<!-- tomotabi-claude-review -->';
const CODEX_MARKER = '<!-- codex-pull-request-review-summary -->';
const FULL_SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const ACTOR = ' __typename ... on User { databaseId } ... on Bot { databaseId } ';
const EVIDENCE_FIELDS = `id url body createdAt updatedAt lastEditedAt author { ${ACTOR} } editor { ${ACTOR} }`;
const QUERIES = {
  comments: `query AgentReviewComments($owner:String!,$name:String!,$number:Int!,$cursor:String,$size:Int!) { repository(owner:$owner,name:$name) { pullRequest(number:$number) { number headRefOid comments(first:$size,after:$cursor) { nodes { ${EVIDENCE_FIELDS} } pageInfo { hasNextPage endCursor } } } } }`,
  reviews: `query AgentReviewReviews($owner:String!,$name:String!,$number:Int!,$cursor:String,$size:Int!) { repository(owner:$owner,name:$name) { pullRequest(number:$number) { number headRefOid reviews(first:$size,after:$cursor) { nodes { ${EVIDENCE_FIELDS} submittedAt state commit { oid } } pageInfo { hasNextPage endCursor } } } } }`,
  threads: `query AgentReviewThreads($owner:String!,$name:String!,$number:Int!,$cursor:String,$size:Int!) { repository(owner:$owner,name:$name) { pullRequest(number:$number) { number headRefOid reviewThreads(first:$size,after:$cursor) { nodes { id isResolved isOutdated comments(first:$size) { nodes { ${EVIDENCE_FIELDS} } pageInfo { hasNextPage endCursor } } } pageInfo { hasNextPage endCursor } } } } }`,
  threadComments: `query AgentReviewThreadComments($id:ID!,$cursor:String,$size:Int!) { node(id:$id) { ... on PullRequestReviewThread { id comments(first:$size,after:$cursor) { nodes { ${EVIDENCE_FIELDS} } pageInfo { hasNextPage endCursor } } } } }`,
};

class EvidenceError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = (code) => { throw new EvidenceError(code); };
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sorted = (values) => [...values].sort((a, b) => compare(String(a.id), String(b.id)));
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
};
const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value)), 'utf8').digest('hex');
const iso = (value) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const unwrap = (response) => {
  if (response?.errors?.length > 0) fail('graphql_unavailable');
  return response?.data ?? response;
};
function configOf(config) {
  if (config?.schema_version !== 1 || !/^[\w.-]+\/[\w.-]+$/.test(config.repository ?? '') || !Number.isSafeInteger(config.repository_id)) fail('config_invalid');
  if (!Array.isArray(config.actor_ids?.claude) || config.actor_ids.claude.length === 0 || !config.actor_ids.claude.every(Number.isSafeInteger) || !Number.isSafeInteger(config.actor_ids.codex) || !Number.isSafeInteger(config.actor_ids.devin)) fail('config_invalid');
  const defaults = { open_prs: 1000, comments: 1000, reviews: 1000, threads: 1000, thread_comments: 5000, max_pages: 10, page_size: 100 };
  const limits = { ...defaults, ...config.limits };
  if (!Object.keys(defaults).every((key) => Number.isSafeInteger(limits[key]) && limits[key] > 0) || limits.page_size > 100) fail('config_invalid');
  return { ...config, limits };
}
function actorId(actor) {
  if (!actor || !['User', 'Bot'].includes(actor.__typename) || !Number.isSafeInteger(actor.databaseId) || actor.databaseId <= 0) fail('actor_unknown');
  return actor.databaseId;
}
function evidenceUrl(url, config, pr) {
  const prefix = `https://github.com/${config.repository}/pull/${pr}`;
  return typeof url === 'string' && (url === prefix || url.startsWith(`${prefix}#`));
}
function metadata(node, config, pr, kind) {
  if (typeof node?.id !== 'string' || node.id.length === 0 || !evidenceUrl(node.url, config, pr) || typeof node.body !== 'string' || !iso(node.createdAt) || !iso(node.updatedAt) || !Object.hasOwn(node, 'editor') || !Object.hasOwn(node, 'lastEditedAt')) fail('evidence_unknown');
  const author = actorId(node.author);
  const editor = node.editor === null ? null : actorId(node.editor);
  if (node.lastEditedAt !== null && !iso(node.lastEditedAt)) fail('editing_unknown');
  if ((node.lastEditedAt === null) !== (editor === null)) fail('editing_unknown');
  const result = { id: node.id, url: node.url, kind, author_id: author, editor_id: editor, last_edited_at: node.lastEditedAt, created_at: node.createdAt, updated_at: node.updatedAt, body_hash: hash(node.body) };
  if (kind === 'review') {
    if (!['PENDING', 'COMMENTED', 'APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(node.state) || (node.state === 'PENDING' ? node.submittedAt !== null : !iso(node.submittedAt)) || (node.commit?.oid !== null && !FULL_SHA.test(node.commit?.oid ?? ''))) fail('review_unknown');
    Object.assign(result, { state: node.state, submitted_at: node.submittedAt, commit_sha: node.commit?.oid ?? null });
  }
  return result;
}
const trustedCodex = (meta, config) => meta.author_id === config.actor_ids.codex && (meta.last_edited_at === null ? meta.editor_id === null : meta.editor_id === config.actor_ids.codex);
const trustedClaude = (meta, config) => config.actor_ids.claude.includes(meta.author_id) && meta.last_edited_at === null && meta.editor_id === null;

function parseClaude(body) {
  const pattern = /^<!-- tomotabi-claude-review -->\r?\n```json\r?\n([\s\S]+?)\r?\n```\s*$/;
  const match = pattern.exec(body);
  if (match === null) fail('completion_invalid');
  let result;
  try { result = JSON.parse(match[1]); } catch { fail('completion_invalid'); }
  if (result?.schema_version !== 1 || !Number.isSafeInteger(result.pr) || result.pr <= 0 || !FULL_SHA.test(result.head_sha ?? '') || !['merge', 'fix', 'escalate'].includes(result.verdict) || !DIGEST.test(result.codex_evidence_hash ?? '') || !iso(result.reviewed_at) || !Array.isArray(result.codex_evidence) || result.codex_evidence.length === 0 || !Array.isArray(result.acknowledged_finding_ids)) fail('completion_invalid');
  if (!result.codex_evidence.every((item) => item && typeof item.id === 'string' && item.id.length > 0 && typeof item.url === 'string') || !result.acknowledged_finding_ids.every((id) => typeof id === 'string' && id.length > 0)) fail('completion_invalid');
  if (new Set(result.codex_evidence.map((item) => item.id)).size !== result.codex_evidence.length || new Set(result.acknowledged_finding_ids).size !== result.acknowledged_finding_ids.length) fail('completion_invalid');
  return { schema_version: 1, pr: result.pr, head_sha: result.head_sha, verdict: result.verdict, codex_evidence_hash: result.codex_evidence_hash, codex_evidence: sorted(result.codex_evidence.map(({ id, url }) => ({ id, url }))), acknowledged_finding_ids: [...result.acknowledged_finding_ids].sort(), reviewed_at: result.reviewed_at };
}
function summaryCommits(body) {
  if (!body.startsWith(`${CODEX_MARKER}\n`) && !body.startsWith(`${CODEX_MARKER}\r\n`)) fail('summary_unknown');
  let fenced = false;
  const lines = body.split(/\r?\n/).filter((line) => {
    if (/^\s*(?:```|~~~)/.test(line)) { fenced = !fenced; return false; }
    return !fenced;
  });
  const header = lines.findIndex((line) => /^\|\s*Review\s*\|\s*Status\s*\|\s*Commit\s*\|\s*Review trigger\s*\|\s*$/.test(line));
  if (header < 0 || !/^\|\s*:?-+:?\s*\|\s*:?-+:?\s*\|\s*:?-+:?\s*\|\s*:?-+:?\s*\|\s*$/.test(lines[header + 1] ?? '')) fail('summary_unknown');
  const commits = [];
  let rows = 0;
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith('|')) break;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 4) fail('summary_unknown');
    rows += 1;
    if (!/^📝\s*\*\*Code Review\*\*$/.test(cells[0])) fail('summary_unknown');
    if (!/^✅\s*\*\*Completed\*\*(?:\s|$)/.test(cells[1])) {
      if (/\*\*(?:In progress|Pending|Queued|Running)\*\*/i.test(cells[1])) continue;
      fail('summary_unknown');
    }
    const match = /^`([0-9a-f]{7,40})`$/.exec(cells[2]);
    if (!match) fail('summary_unknown');
    commits.push(match[1]);
  }
  if (rows === 0) fail('summary_unknown');
  return [...new Set(commits)].sort();
}

function connectionNodes(connection, previousIds, maximum) {
  if (!connection || !Array.isArray(connection.nodes) || typeof connection.pageInfo?.hasNextPage !== 'boolean') fail('pagination_unknown');
  for (const node of connection.nodes) {
    if (!node || typeof node.id !== 'string' || previousIds.has(node.id)) fail('pagination_conflict');
    previousIds.add(node.id);
  }
  if (previousIds.size >= maximum) fail('pagination_limit');
  if (connection.pageInfo.hasNextPage && (typeof connection.pageInfo.endCursor !== 'string' || connection.pageInfo.endCursor.length === 0)) fail('pagination_unknown');
  return connection.nodes;
}
async function graphPages(client, query, variables, extract, maximum, limits, initial = null) {
  const result = [];
  const ids = new Set();
  const cursors = new Set();
  let cursor = null;
  let page = initial;
  const maxPages = Math.max(limits.max_pages, Math.ceil(maximum / limits.page_size));
  for (let index = 0; index < maxPages; index += 1) {
    page ??= extract(unwrap(await client.graphql(query, { ...variables, cursor, size: limits.page_size })));
    result.push(...connectionNodes(page, ids, maximum));
    if (!page.pageInfo.hasNextPage) return result;
    cursor = page.pageInfo.endCursor;
    if (cursors.has(cursor)) fail('pagination_conflict');
    cursors.add(cursor);
    page = null;
  }
  fail('pagination_limit');
}
function registered(number, records) {
  if (Array.isArray(records)) return records.some((record) => record === number || (record && (record.pr ?? record.number) === number && record.target !== false && record.finalized !== true));
  if (!records || typeof records !== 'object') return false;
  return Object.entries(records).some(([key, record]) => Number(key) === number && record && record.finalized !== true && (record.target === true || typeof record.task_key === 'string'));
}
function normalizePr(pr, config, registeredPrs) {
  if (!Number.isSafeInteger(pr?.number) || pr.number <= 0 || pr.state !== 'open' || !FULL_SHA.test(pr.head?.sha ?? '') || typeof pr.head?.ref !== 'string' || typeof pr.base?.ref !== 'string' || pr.base?.repo?.id !== config.repository_id || !Number.isSafeInteger(pr.user?.id) || typeof pr.draft !== 'boolean') fail('pr_unknown');
  return { pr: pr.number, head_sha: pr.head.sha, head_ref: pr.head.ref, base_ref: pr.base.ref, author_id: pr.user.id, draft: pr.draft, target: pr.user.id === config.actor_ids.devin || pr.head.ref.startsWith('devin/') || registered(pr.number, registeredPrs) };
}
const evidenceHash = (completions, findings, reviews) => hash({ completions: sorted(completions), findings: sorted(findings), reviews: sorted(reviews) });
const snapshotHash = (snapshot) => hash({ schema_version: snapshot.schema_version, head_sha: snapshot.head_sha, repository_id: snapshot.repository_id, open_prs: snapshot.open_prs, prs: snapshot.prs, unknown: snapshot.unknown, errors: snapshot.errors });

async function collectPr(client, config, pr) {
  const [owner, name] = config.repository.split('/');
  const variables = { owner, name, number: pr.pr };
  const extract = (key) => (response) => {
    const value = response?.repository?.pullRequest;
    if (!value || value.number !== pr.pr || value.headRefOid !== pr.head_sha) fail('pr_changed');
    return value[key === 'threads' ? 'reviewThreads' : key];
  };
  const comments = await graphPages(client, QUERIES.comments, variables, extract('comments'), config.limits.comments, config.limits);
  const reviews = await graphPages(client, QUERIES.reviews, variables, extract('reviews'), config.limits.reviews, config.limits);
  const threads = await graphPages(client, QUERIES.threads, variables, extract('threads'), config.limits.threads, config.limits);
  const completions = [];
  const findings = [];
  const claude = [];
  const reviewEvidence = [];
  let commitList = null;
  async function resolveSummarySha(short) {
    commitList ??= await client.paginate(`repos/${config.repository}/pulls/${pr.pr}/commits`, { pageSize: config.limits.page_size, maxPages: config.limits.max_pages, maxItems: 1000 });
    if (!Array.isArray(commitList) || commitList.length >= 1000 || !commitList.every((commit) => FULL_SHA.test(commit.sha ?? ''))) fail('commit_unknown');
    const matches = commitList.filter((commit) => commit.sha.startsWith(short));
    if (matches.length !== 1) fail('commit_unknown');
    if (FULL_SHA.test(short)) return matches[0].sha;
    const resolved = await client.rest('GET', `repos/${config.repository}/commits/${short}`);
    if (resolved?.sha !== matches[0].sha) fail('commit_unknown');
    return resolved.sha;
  }
  for (const [kind, nodes] of [['comment', comments], ['review', reviews]]) {
    for (const node of nodes) {
      const author = actorId(node.author);
      if (author !== config.actor_ids.codex && !config.actor_ids.claude.includes(author)) continue;
      const meta = metadata(node, config, pr.pr, kind);
      if (config.actor_ids.claude.includes(author)) {
        if (!node.body.startsWith(CLAUDE_MARKER)) continue;
        let completion = null;
        let valid = trustedClaude(meta, config);
        if (kind === 'review') valid &&= ['COMMENTED', 'APPROVED', 'CHANGES_REQUESTED'].includes(node.state) && iso(node.submittedAt);
        try { completion = parseClaude(node.body); } catch { valid = false; }
        if (completion && (completion.pr !== pr.pr || !completion.codex_evidence.every((item) => evidenceUrl(item.url, config, pr.pr)))) valid = false;
        claude.push({ ...meta, valid, completion });
        continue;
      }
      if (!trustedCodex(meta, config)) fail('editing_unknown');
      if (kind === 'review') reviewEvidence.push(meta);
      if (kind === 'comment' && node.body.startsWith(CODEX_MARKER)) {
        for (const short of summaryCommits(node.body)) {
          const sha = await resolveSummarySha(short);
          if (sha === pr.head_sha) completions.push({ ...meta, id: `${meta.id}:${sha}`, evidence_id: meta.id, commit_sha: sha });
        }
        continue;
      }
      if (kind === 'review') {
        if (node.state === 'PENDING' || node.submittedAt === null) continue;
        if (!['COMMENTED', 'APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(node.state) || !iso(node.submittedAt) || !FULL_SHA.test(node.commit?.oid ?? '')) fail('review_unknown');
        if (node.state !== 'DISMISSED' && node.commit.oid === pr.head_sha) completions.push({ ...meta, evidence_id: meta.id, commit_sha: node.commit.oid, submitted_at: node.submittedAt, state: node.state });
      }
      if (node.body.trim().length > 0) findings.push({ ...meta, thread_id: null, resolved: false });
    }
  }
  let threadComments = 0;
  for (const thread of threads) {
    if (typeof thread.isResolved !== 'boolean' || typeof thread.isOutdated !== 'boolean') fail('thread_unknown');
    const nodes = await graphPages(client, QUERIES.threadComments, { id: thread.id }, (response) => {
      if (response?.node?.id !== thread.id) fail('thread_unknown');
      return response.node.comments;
    }, config.limits.thread_comments, config.limits, thread.comments);
    threadComments += nodes.length;
    if (threadComments >= config.limits.thread_comments) fail('pagination_limit');
    for (const node of nodes) {
      const author = actorId(node.author);
      if (author !== config.actor_ids.codex) continue;
      const meta = metadata(node, config, pr.pr, 'thread-comment');
      if (!trustedCodex(meta, config)) fail('editing_unknown');
      findings.push({ ...meta, thread_id: thread.id, resolved: thread.isResolved });
    }
  }
  return { ...pr, codex_completions: sorted(completions), codex_findings: sorted(findings), codex_review_evidence: sorted(reviewEvidence), claude_completions: sorted(claude), codex_evidence_hash: evidenceHash(completions, findings, reviewEvidence) };
}

/** 全ページを取得できない場合はunknownを返し、本文をsnapshotに含めない。 */
export async function collectReviewSnapshot(client, config, headSha, { registeredPrs = [] } = {}) {
  const snapshot = { schema_version: 1, head_sha: headSha, repository_id: config?.repository_id ?? null, open_prs: [], prs: [], unknown: false, errors: [] };
  try {
    const settings = configOf(config);
    if (!FULL_SHA.test(headSha ?? '')) fail('head_invalid');
    const raw = await client.paginate(`repos/${settings.repository}/pulls?state=open`, { pageSize: settings.limits.page_size, maxPages: settings.limits.max_pages, maxItems: settings.limits.open_prs });
    if (!Array.isArray(raw) || raw.length >= settings.limits.open_prs) fail('pagination_limit');
    snapshot.open_prs = raw.map((pr) => normalizePr(pr, settings, registeredPrs)).sort((a, b) => a.pr - b.pr);
    if (new Set(snapshot.open_prs.map((pr) => pr.pr)).size !== snapshot.open_prs.length) fail('pagination_conflict');
    for (const pr of snapshot.open_prs.filter((item) => item.head_sha === headSha)) snapshot.prs.push(pr.target ? await collectPr(client, settings, pr) : { ...pr });
  } catch (error) {
    snapshot.unknown = true;
    snapshot.errors = [error instanceof EvidenceError ? error.code : 'collection_unavailable'];
  }
  snapshot.snapshot_hash = snapshotHash(snapshot);
  return snapshot;
}

function prReady(pr, config) {
  if (!Array.isArray(pr.codex_completions) || !Array.isArray(pr.codex_findings) || !Array.isArray(pr.codex_review_evidence) || !Array.isArray(pr.claude_completions) || pr.codex_completions.length === 0) return false;
  if (!pr.codex_completions.every((item) => trustedCodex(item, config) && item.commit_sha === pr.head_sha && evidenceUrl(item.url, config, pr.pr)) || !pr.codex_findings.every((item) => trustedCodex(item, config) && evidenceUrl(item.url, config, pr.pr))) return false;
  const currentHash = evidenceHash(pr.codex_completions, pr.codex_findings, pr.codex_review_evidence);
  if (pr.codex_evidence_hash !== currentHash) return false;
  const latest = [...pr.claude_completions].filter((item) => item.completion === null || item.completion.head_sha === pr.head_sha).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || compare(a.id, b.id)).at(-1);
  if (!latest || !latest.valid || !trustedClaude(latest, config) || !evidenceUrl(latest.url, config, pr.pr)) return false;
  const completion = latest.completion;
  if (completion?.pr !== pr.pr || completion.verdict !== 'merge' || completion.codex_evidence_hash !== currentHash) return false;
  const expected = sorted([...new Map(pr.codex_completions.map((item) => [item.evidence_id, { id: item.evidence_id, url: item.url }])).values()]);
  if (JSON.stringify(canonical(completion.codex_evidence)) !== JSON.stringify(canonical(expected))) return false;
  const acknowledged = new Set(completion.acknowledged_finding_ids);
  return pr.codex_findings.every((finding) => finding.thread_id === null ? acknowledged.has(finding.id) : finding.resolved === true);
}

/** 同じheadの対象PR全件に固有の証拠を要求し、GitHubには書かない。 */
export function evaluateSha(snapshot, config) {
  let status = 'completed';
  let conclusion = 'failure';
  let targets = [];
  try {
    const settings = configOf(config);
    if (!snapshot || snapshot.schema_version !== 1 || snapshot.repository_id !== settings.repository_id || !FULL_SHA.test(snapshot.head_sha ?? '') || snapshot.snapshot_hash !== snapshotHash(snapshot)) fail('snapshot_invalid');
    if (snapshot.unknown) { status = 'in_progress'; conclusion = null; }
    else {
      const matching = snapshot.open_prs.filter((pr) => pr.head_sha === snapshot.head_sha);
      if (new Set(matching.map((pr) => pr.pr)).size !== matching.length || JSON.stringify(matching.map(({ pr, target, draft }) => ({ pr, target, draft }))) !== JSON.stringify(snapshot.prs.map(({ pr, target, draft }) => ({ pr, target, draft })))) fail('snapshot_invalid');
      targets = snapshot.prs.filter((pr) => pr.target);
      if (targets.some((pr) => pr.draft)) { status = 'in_progress'; conclusion = null; }
      else if (targets.every((pr) => prReady(pr, settings))) conclusion = 'success';
    }
  } catch { conclusion = 'failure'; }
  const headSha = snapshot?.head_sha ?? null;
  const check = { name: 'agent-review', head_sha: headSha, status, output: { title: conclusion === 'success' ? 'レビューの確認が完了しました' : 'レビューの確認が必要です', summary: `対象コミット: ${FULL_SHA.test(headSha ?? '') ? headSha : '未確認'}\n${targets.map((pr) => `PR #${pr.pr}: https://github.com/${config?.repository ?? ''}/pull/${pr.pr}`).join('\n')}` } };
  if (status === 'completed') check.conclusion = conclusion;
  return { status, conclusion, head_sha: headSha, snapshot_hash: snapshot?.snapshot_hash ?? null, target_prs: targets.map((pr) => pr.pr), check };
}

/** 完了コメントの生成だけを行う。投稿と証拠の正しさの確認は呼出元が担う。 */
export function createClaudeCompletion(input) {
  const completion = { schema_version: 1, pr: input.pr, head_sha: input.headSha ?? input.head_sha, verdict: input.verdict ?? 'merge', codex_evidence_hash: input.codexEvidenceHash ?? input.codex_evidence_hash, codex_evidence: input.codexEvidence ?? input.codex_evidence, acknowledged_finding_ids: input.acknowledgedFindingIds ?? input.acknowledged_finding_ids ?? [], reviewed_at: input.reviewedAt ?? input.reviewed_at ?? new Date().toISOString() };
  const parsed = parseClaude(`${CLAUDE_MARKER}\n\`\`\`json\n${JSON.stringify(completion)}\n\`\`\``);
  if (!parsed.codex_evidence.every((item) => /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+(?:#\S+)?$/.test(item.url))) fail('completion_invalid');
  return `${CLAUDE_MARKER}\n\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [, , command, flag, path, ...rest] = process.argv;
    if (command !== 'completion' || flag !== '--input' || !path || rest.length !== 0) fail('usage: agent-review.mjs completion --input <JSON-file>');
    process.stdout.write(`${createClaudeCompletion(JSON.parse(readFileSync(path, 'utf8')))}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof EvidenceError ? error.code : 'completion_input_invalid'}\n`);
    process.exitCode = 2;
  }
}
