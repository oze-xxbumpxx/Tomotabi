import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { createGitHubClient } from './delegation-github.mjs';
import {
  DelegationError, EVENT_MARKER, ANCHOR_MARKER, TASK_MARKER, ZERO_HASH, canonicalJson, hashJson,
  parseRequestComment, extractPlanTask, createJournalEvent, formatAnchor,
  readSnapshot, readIssueComments, uneditedComment, reduceRequest, verifyControlRun, verifyMainCommit,
} from './delegation-shared.mjs';

const fail = (code) => { throw new DelegationError(code); };
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const publicError = (error) => error instanceof DelegationError ? error.code : 'communication_unknown';
const systemMeta = (run, operation) => ({ source_run_id: run.id, source_run_attempt: run.run_attempt, request_id: null, request_comment_id: null, operation });

/** 追記と先頭位置を読み直すまで、起票と許可を進めない。 */
export async function persistEvent(client, config, state, changes, meta, result) {
  const event = createJournalEvent(state, changes, meta, result, { maxBytes: config.limits?.event_bytes ?? 49152 });
  let comment = null;
  try {
    comment = await client.rest('POST', `/repos/${config.repository}/issues/${config.management_issue}/comments`, { body: `${EVENT_MARKER}\n${canonicalJson(event)}` });
  } catch {
    const observed = await readSnapshot(client, config);
    const matches = observed.events.filter((entry) => entry.event.seq === event.seq && entry.event.hash === event.hash);
    if (matches.length !== 1) fail('journal_write_unknown');
    comment = { id: matches[0].comment_id };
  }
  if (!positive(comment?.id)) fail('journal_write_unknown');
  let observed = await readSnapshot(client, config);
  if (observed.seq !== event.seq || observed.hash !== event.hash || observed.recovered_pointer.last_event_id !== comment.id) fail('journal_write_unknown');
  try {
    await client.rest('PATCH', `/repos/${config.repository}/issues/comments/${config.anchor_comment_id}`, { body: formatAnchor(observed.recovered_pointer) });
  } catch {
    // PATCHの応答喪失も再送せず、保存された先頭位置を照合する。
  }
  observed = await readSnapshot(client, config);
  if (observed.recovery || observed.pointer.last_seq !== event.seq || observed.pointer.last_hash !== event.hash || observed.pointer.last_event_id !== comment.id) fail('anchor_write_unknown');
  return observed;
}

async function recoverAnchor(client, config, state) {
  if (!state.recovery) return state;
  await client.rest('PATCH', `/repos/${config.repository}/issues/comments/${config.anchor_comment_id}`, { body: formatAnchor(state.recovered_pointer) });
  const observed = await readSnapshot(client, config);
  if (observed.recovery || observed.seq !== state.seq || observed.hash !== state.hash) fail('anchor_write_unknown');
  return observed;
}

async function content(client, config, path, ref) {
  const response = await client.rest('GET', `/repos/${config.repository}/contents/${path}?ref=${ref}`);
  if (response?.type !== 'file' || response.encoding !== 'base64' || typeof response.content !== 'string' || response.size > 262144) fail('plan_unverified');
  return Buffer.from(response.content, 'base64').toString('utf8');
}

export async function verifyPlan(client, config, request) {
  await verifyMainCommit(client, config, request.plan_sha);
  const progressPath = `docs/discussions/${request.task_key.split(':')[0]}.progress.json`;
  let progress = null;
  try { progress = JSON.parse(await content(client, config, progressPath, request.plan_sha)); } catch { fail('plan_unverified'); }
  const approval = progress?.stages?.design;
  if (progress.feature !== request.task_key.split(':')[0] || approval?.state !== 'done' || !positive(approval?.approved?.pr)) fail('plan_unapproved');
  const pr = await client.rest('GET', `/repos/${config.repository}/pulls/${approval.approved.pr}`);
  if (pr?.merged !== true || pr?.base?.repo?.id !== config.repository_id || typeof pr.merge_commit_sha !== 'string') fail('plan_unapproved');
  await verifyMainCommit(client, config, pr.merge_commit_sha);
  const extracted = extractPlanTask(await content(client, config, request.plan_path, request.plan_sha), request.task_key);
  if (extracted.task_digest !== request.task_digest) fail('content_conflict');
  return extracted;
}

function taskMark(body) {
  if (typeof body !== 'string' || !body.startsWith(`${TASK_MARKER}\n`)) return null;
  try { return JSON.parse(body.slice(TASK_MARKER.length + 1).split('\n')[0]); } catch { fail('issue_marker_unknown'); }
}

export async function findCreatedIssue(client, config, task) {
  const issues = await client.paginate(`/repos/${config.repository}/issues?state=all`, { maxPages: config.limits?.max_pages ?? 10, maxItems: config.limits?.comments ?? 1000 });
  const matches = issues.filter((issue) => {
    if (issue.pull_request || issue.user?.id !== config.actor_ids.actions) return false;
    const mark = taskMark(issue.body);
    return mark?.task_key === task.task_key && mark.task_digest === task.task_digest && mark.issue_attempt_id === task.issue_attempt_id;
  });
  if (matches.length > 1) fail('issue_conflict');
  return matches[0] ?? null;
}

async function issueVerified(client, config, task) {
  if (!positive(task?.issue)) return false;
  const issue = await client.rest('GET', `/repos/${config.repository}/issues/${task.issue}`);
  if (issue?.number !== task.issue || issue.pull_request || issue.state !== 'open') return false;
  const mark = taskMark(issue.body);
  return task.issue_attempt_id === undefined || (mark?.task_key === task.task_key && mark.task_digest === task.task_digest && mark.issue_attempt_id === task.issue_attempt_id && issue.user?.id === config.actor_ids.actions);
}

async function verifyPr(client, config, number, issue = null) {
  const pr = await client.rest('GET', `/repos/${config.repository}/pulls/${number}`);
  if (pr?.number !== number || pr.base?.repo?.id !== config.repository_id || !/^[0-9a-f]{40}$/.test(pr.head?.sha ?? '')) fail('pr_unverified');
  if (issue !== null) {
    const [owner, name] = config.repository.split('/');
    let cursor = null;
    let count = 0;
    let linked = false;
    const seen = new Set();
    for (let page = 0; ; page += 1) {
      if (page >= config.limits.max_pages) fail('pr_link_unknown');
      const data = await client.graphql(`query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){closingIssuesReferences(first:100,after:$cursor){nodes{number repository{databaseId}}pageInfo{hasNextPage endCursor}}}}}`, { owner, name, number, cursor });
      const refs = data?.repository?.pullRequest?.closingIssuesReferences;
      if (!Array.isArray(refs?.nodes) || typeof refs.pageInfo?.hasNextPage !== 'boolean' || refs.nodes.some((ref) => !positive(ref?.number) || !positive(ref.repository?.databaseId))) fail('pr_link_unknown');
      count += refs.nodes.length;
      if (count >= (config.limits.comments ?? 1000)) fail('pr_link_unknown');
      linked ||= refs.nodes.some((ref) => ref.number === issue && ref.repository.databaseId === config.repository_id);
      if (!refs.pageInfo.hasNextPage) break;
      if (typeof refs.pageInfo.endCursor !== 'string' || refs.pageInfo.endCursor === '' || seen.has(refs.pageInfo.endCursor)) fail('pr_link_unknown');
      cursor = refs.pageInfo.endCursor;
      seen.add(cursor);
    }
    if (!linked) fail('pr_link_unverified');
  }
  return { head_sha: pr.head.sha, pr_state: pr.state === 'open' ? 'OPEN' : pr.merged ? 'MERGED' : 'CLOSED' };
}

function receiptMeta(run, comment, request) {
  return { ...systemMeta(run, request.operation), request_id: request.request_id, request_comment_id: comment.id, request_hash: hashJson(request) };
}

async function processRequest(client, config, state, run, comment, request, { now, uuid, review }) {
  if (!config.actor_ids.request.includes(comment.author_id) || !uneditedComment(comment)) fail('request_author_unverified');
  const previous = state.requests[request.request_id];
  if (previous) {
    const code = previous.request_hash !== hashJson(request) ? 'request_conflict' : request.operation === 'begin' ? 'already_begun' : 'request_replayed';
    const deliveries = [...(previous.deliveries ?? []), { request_comment_id: comment.id, request_hash: hashJson(request), code }];
    return persistEvent(client, config, state, { requests: { [request.request_id]: { ...previous, deliveries } } }, systemMeta(run, 'request-replay'), { code, allowed: false });
  }
  const meta = receiptMeta(run, comment, request);
  const context = { config, now: now(), attempt_id: uuid() };
  let plan = null;
  let reduced = null;
  try {
    if (request.operation === 'register' && !state.tasks[request.task_key]) {
      plan = await verifyPlan(client, config, request);
      context.plan_verified = true;
    }
    if (request.operation === 'claim') context.issue_verified = await issueVerified(client, config, state.tasks[request.task_key]);
    if (request.operation === 'started') context.session_verified = typeof request.session_id === 'string' && typeof request.session_url === 'string' && request.session_url.replace(/\/$/, '').split('/').at(-1) === request.session_id;
    if (request.operation === 'link-pr') {
      const task = state.tasks[request.task_key];
      if (!task) fail('pr_unverified');
      Object.assign(context, await verifyPr(client, config, request.pr, task.issue), { link_verified: true });
    }
    if (request.operation === 'import') {
      if (request.issue) {
        const issue = await client.rest('GET', `/repos/${config.repository}/issues/${request.issue}`);
        if (issue?.number !== request.issue || issue.pull_request) fail('import_unverified');
        context.import_issue_verified = true;
      }
      if (request.pr) Object.assign(context, await verifyPr(client, config, request.pr, request.issue ?? null), { import_pr_verified: true });
    }
    reduced = reduceRequest(state, request, context);
  } catch (error) {
    if (!(error instanceof DelegationError)) throw error;
    return persistEvent(client, config, state, {}, meta, { code: publicError(error), allowed: false });
  }
  state = await persistEvent(client, config, state, reduced.changes, meta, reduced.result);
  if (request.operation === 'register' && reduced.result.code === 'registered') {
    return createTaskIssue(client, config, state, state.tasks[request.task_key], plan, meta, uuid);
  }
  if (request.operation === 'review-refresh') {
    const pr = await verifyPr(client, config, request.pr);
    const oldSha = state.prs[request.pr]?.head_sha ?? null;
    for (const sha of [...new Set([oldSha, pr.head_sha].filter(Boolean))]) state = await refreshSha(client, config, state, run, sha, review, { meta });
    state = await persistEvent(client, config, state, {}, meta, { code: 'review_refreshed', pr: request.pr, allowed: false });
  }
  if (request.operation === 'reconcile') state = await reconcileTasks(client, config, state, run, now, uuid);
  return state;
}

async function createTaskIssue(client, config, state, task, plan, meta, uuid) {
  const creating = { ...task, state: 'issue_creating', issue_attempt_id: uuid() };
  state = await persistEvent(client, config, state, { tasks: { [task.task_key]: creating } }, meta, { code: 'issue_creating', task_key: task.task_key, allowed: false });
  let created = null;
  try {
    const marker = { task_key: task.task_key, task_digest: task.task_digest, issue_attempt_id: creating.issue_attempt_id };
    created = await client.rest('POST', `/repos/${config.repository}/issues`, { title: `委譲 ${task.task_key}`, body: `${TASK_MARKER}\n${canonicalJson(marker)}\n\n${plan.body}` });
    if (!positive(created?.number)) created = null;
  } catch {
    try { created = await findCreatedIssue(client, config, creating); } catch { created = null; }
  }
  return persistEvent(client, config, state, { tasks: { [task.task_key]: { ...creating, state: created === null ? 'issue_unknown' : 'issue_ready', issue: created?.number ?? null } } }, meta, { code: created === null ? 'issue_unknown' : 'issue_ready', task_key: task.task_key, issue: created?.number ?? null, allowed: false });
}

async function reconcileTasks(client, config, state, run, now, uuid) {
  for (const task of Object.values(state.tasks)) {
    if (task.state === 'registered') {
      if (config.migration_complete !== true) fail('migration_pending');
      const receipt = Object.entries(state.requests).find(([, record]) => record.operation === 'register' && record.result.code === 'registered' && record.result.task_key === task.task_key);
      if (!receipt) fail('registration_unknown');
      const [requestId, record] = receipt;
      const plan = await verifyPlan(client, config, task);
      const meta = { ...systemMeta(run, 'register'), request_id: requestId, request_comment_id: record.request_comment_id, request_hash: record.request_hash };
      state = await createTaskIssue(client, config, state, task, plan, meta, uuid);
    } else if (['reserved', 'launching'].includes(task.state) && Date.parse(now()) - Date.parse(task.reserved_at) >= 900_000) {
      state = await persistEvent(client, config, state, { tasks: { [task.task_key]: { ...task, state: 'launch_unknown' } } }, systemMeta(run, 'expiry'), { code: 'launch_unknown', allowed: false });
    } else if (['issue_creating', 'issue_unknown'].includes(task.state)) {
      const issue = await findCreatedIssue(client, config, task);
      if (issue !== null) {
        const receipt = Object.entries(state.requests).find(([, record]) => record.operation === 'register' && ['issue_creating', 'issue_unknown'].includes(record.result.code) && record.result.task_key === task.task_key);
        const meta = receipt
          ? { ...systemMeta(run, 'register'), request_id: receipt[0], request_comment_id: receipt[1].request_comment_id, request_hash: receipt[1].request_hash }
          : systemMeta(run, 'issue-reconcile');
        state = await persistEvent(client, config, state, { tasks: { [task.task_key]: { ...task, issue: issue.number, state: 'issue_ready' } } }, meta, { code: 'issue_ready', task_key: task.task_key, issue: issue.number, allowed: false });
      }
    }
  }
  return state;
}

async function ensureCheck(client, config, state, run, headSha) {
  let record = state.checks[headSha];
  if (!record) {
    record = { head_sha: headSha, check_id: null, state: 'creating', external_id: `tomotabi-agent-review:${headSha}:${randomUUID()}` };
    state = await persistEvent(client, config, state, { checks: { [headSha]: record } }, systemMeta(run, 'check-creating'), { code: 'check_pending', allowed: false });
    let check = null;
    try {
      check = await client.rest('POST', `/repos/${config.repository}/check-runs`, { name: 'agent-review', head_sha: headSha, external_id: record.external_id, status: 'in_progress', output: { title: 'レビューを確認中', summary: '現在の証拠を確認しています。' } });
    } catch {
      // 結果不明のcreateは、次回も同じexternal_idを検索してから進む。
    }
    if (positive(check?.id) && check.head_sha === headSha && check.name === 'agent-review') record = { ...record, check_id: check.id, state: 'in_progress' };
  }
  if (record.check_id === null) {
    const checks = await client.paginate(`/repos/${config.repository}/commits/${headSha}/check-runs?check_name=agent-review&filter=all`, { key: 'check_runs', maxPages: config.limits.max_pages, maxItems: config.limits.reviews });
    const matches = checks.filter((check) => check.external_id === record.external_id && check.name === 'agent-review' && check.head_sha === headSha);
    if (matches.length !== 1) fail(matches.length > 1 ? 'check_conflict' : 'check_create_unknown');
    record = { ...record, check_id: matches[0].id, state: 'in_progress' };
  }
  if (state.checks[headSha]?.check_id !== record.check_id) state = await persistEvent(client, config, state, { checks: { [headSha]: record } }, systemMeta(run, 'check-linked'), { code: 'check_pending', allowed: false });
  state = await persistEvent(client, config, state, { checks: { [headSha]: { ...record, state: 'in_progress', conclusion: null } } }, systemMeta(run, 'review-started'), { code: 'review_pending', allowed: false });
  let current = null;
  try { current = await client.rest('GET', `/repos/${config.repository}/check-runs/${record.check_id}`); } catch { fail('check_write_unknown'); }
  if (current?.head_sha !== headSha || current.name !== 'agent-review' || current.external_id !== record.external_id) fail('check_unverified');
  let pending = null;
  try {
    await client.rest('PATCH', `/repos/${config.repository}/check-runs/${record.check_id}`, { status: 'in_progress', output: { title: 'レビューを確認中', summary: '現在の証拠を確認しています。' } });
    pending = await client.rest('GET', `/repos/${config.repository}/check-runs/${record.check_id}`);
  } catch { fail('check_write_unknown'); }
  if (pending?.status !== 'in_progress' || pending.conclusion !== null) fail('check_write_unknown');
  return state;
}

export async function refreshSha(client, config, state, run, headSha, review, { meta = null } = {}) {
  state = await ensureCheck(client, config, state, run, headSha);
  const first = await review.collectReviewSnapshot(client, config, headSha, { registeredPrs: state.prs });
  const observedTargets = {};
  for (const pr of first.open_prs ?? []) {
    const number = pr.number ?? pr.pr;
    if (pr.target !== true) continue;
    const observedSha = pr.head_sha ?? pr.head?.sha;
    if (!positive(number) || !/^[0-9a-f]{40}$/.test(observedSha ?? '')) fail('review_unknown');
    observedTargets[number] = { ...state.prs[number], pr: number, head_sha: observedSha, target: true, state: 'OPEN' };
  }
  if (Object.keys(observedTargets).length > 0) state = await persistEvent(client, config, state, { prs: observedTargets }, systemMeta(run, 'review-targets'), { code: 'review_pending', allowed: false });
  let decision = review.evaluateSha(first, config);
  const second = await review.collectReviewSnapshot(client, config, headSha, { registeredPrs: state.prs });
  if (first.unknown || second.unknown || first.snapshot_hash !== second.snapshot_hash) {
    decision = { status: 'in_progress', conclusion: null, check: { name: 'agent-review', head_sha: headSha, status: 'in_progress', output: { title: '確認が必要', summary: '現在の証拠を確認できません。' } } };
  } else decision = review.evaluateSha(second, config);
  const changes = { prs: {}, checks: {} };
  for (const pr of second.open_prs ?? []) {
    const number = pr.number ?? pr.pr;
    if (!positive(number)) fail('review_unknown');
    const previous = state.prs[number];
    const target = previous?.target === true || pr.target === true || (decision.target_prs ?? []).includes(number);
    const currentSha = pr.head_sha ?? pr.head?.sha;
    if (target || previous || currentSha === headSha) changes.prs[number] = { ...previous, pr: number, head_sha: currentSha, target, state: 'OPEN' };
  }
  const record = { ...state.checks[headSha], state: 'in_progress', conclusion: null, snapshot_hash: second.snapshot_hash ?? null };
  changes.checks[headSha] = record;
  state = await persistEvent(client, config, state, changes, systemMeta(run, 'review-evaluated'), { code: 'review_checked', allowed: false });
  // 保存の間の変化も確認し、成功を古い証拠で書かない。
  const final = await review.collectReviewSnapshot(client, config, headSha, { registeredPrs: state.prs });
  if (final.unknown || final.snapshot_hash !== second.snapshot_hash) decision = { status: 'in_progress', conclusion: null, check: { name: 'agent-review', head_sha: headSha, status: 'in_progress', output: { title: '確認が必要', summary: '現在の証拠を確認できません。' } } };
  const payload = { ...decision.check };
  delete payload.head_sha;
  delete payload.name;
  if (payload.conclusion === null) delete payload.conclusion;
  let actual = null;
  try {
    await client.rest('PATCH', `/repos/${config.repository}/check-runs/${record.check_id}`, payload);
    actual = await client.rest('GET', `/repos/${config.repository}/check-runs/${record.check_id}`);
  } catch { fail('check_write_unknown'); }
  if (actual?.status !== decision.status || (actual.conclusion ?? null) !== (decision.conclusion ?? null)) fail('check_write_unknown');
  state = await persistEvent(client, config, state, { checks: { [headSha]: { ...record, state: decision.status, conclusion: decision.conclusion ?? null } } }, meta ?? systemMeta(run, 'review-completed'), { code: 'review_checked', allowed: false });
  return state;
}

export function decodeNotificationZip(zip, { maxBytes = 8192 } = {}) {
  if (!Buffer.isBuffer(zip) || zip.length > 65536) fail('notification_unknown');
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > zip.length || zip.readUInt16LE(eocd + 10) !== 1) fail('notification_unknown');
  const central = zip.readUInt32LE(eocd + 16);
  if (central + 46 > zip.length || zip.readUInt32LE(central) !== 0x02014b50) fail('notification_unknown');
  const flags = zip.readUInt16LE(central + 8);
  const compression = zip.readUInt16LE(central + 10);
  const size = zip.readUInt32LE(central + 20);
  const expanded = zip.readUInt32LE(central + 24);
  const nameLength = zip.readUInt16LE(central + 28);
  const local = zip.readUInt32LE(central + 42);
  if (flags & 1 || expanded > maxBytes || ![0, 8].includes(compression) || zip.subarray(central + 46, central + 46 + nameLength).toString('utf8') !== 'notification.json' || local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) fail('notification_unknown');
  const from = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  if (from + size > central) fail('notification_unknown');
  let decoded = null;
  try {
    decoded = compression === 0 ? zip.subarray(from, from + size) : inflateRawSync(zip.subarray(from, from + size), { maxOutputLength: maxBytes });
  } catch { fail('notification_unknown'); }
  if (decoded.length !== expanded || decoded.length > maxBytes) fail('notification_unknown');
  try {
    const parsed = JSON.parse(decoded.toString('utf8'));
    if (!parsed || parsed.schema_version !== 1 || !positive(parsed.pr) || !positive(parsed.run_id) || !positive(parsed.repository_id) || typeof parsed.event !== 'string' || Object.keys(parsed).some((key) => !['schema_version', 'repository_id', 'pr', 'event', 'run_id'].includes(key))) fail('notification_unknown');
    return parsed;
  } catch { fail('notification_unknown'); }
}

async function notificationPrs(client, config, event) {
  if (event?.workflow_run) {
    const incoming = await client.rest('GET', `/repos/${config.repository}/actions/runs/${event.workflow_run.id}`);
    if (incoming?.repository?.id !== config.repository_id) fail('notification_unverified');
    const workflow = await client.rest('GET', `/repos/${config.repository}/actions/workflows/${incoming.workflow_id}`);
    if (workflow?.path === config.listener_workflow_path && incoming.workflow_id === config.listener_workflow_id) {
      const artifacts = await client.paginate(`/repos/${config.repository}/actions/runs/${incoming.id}/artifacts`, { key: 'artifacts', maxPages: config.limits.max_pages, maxItems: 1000 });
      const matches = artifacts.filter((artifact) => artifact.name === 'delegation-notification' && artifact.expired === false);
      if (matches.length !== 1) fail('notification_unknown');
      const parsed = decodeNotificationZip(await client.downloadArtifact(`/repos/${config.repository}/actions/artifacts/${matches[0].id}/zip`));
      if (parsed.repository_id !== config.repository_id || parsed.run_id !== incoming.id || parsed.event !== incoming.event) fail('notification_unverified');
      return [parsed.pr];
    }
    if (!['.github/workflows/ci.yml', '.github/workflows/e2e.yml'].includes(workflow?.path)) fail('notification_unverified');
    const prs = incoming.pull_requests?.map((pr) => pr.number) ?? [];
    if (prs.length === 0 || !prs.every(positive)) fail('notification_unknown');
    return prs;
  }
  if (positive(event?.issue?.number) && event.issue.pull_request) return [event.issue.number];
  if (event?.inputs?.operation === 'review-refresh') {
    const pr = Number(event.inputs.pr);
    if (!positive(pr)) fail('invalid_pr');
    return [pr];
  }
  return [];
}

export async function runController({ client, config, runId, runAttempt, runtimeSha = null, event = {}, now = () => new Date().toISOString(), uuid = randomUUID, review = null } = {}) {
  if (!positive(config?.management_issue) || !positive(config?.controller_workflow_id) || (event?.inputs?.operation !== 'initialize' && !positive(config?.anchor_comment_id))) fail('uninitialized');
  const run = await verifyControlRun(client, config, runId, runAttempt);
  if (run.id !== runId || (runtimeSha !== null && run.head_sha !== runtimeSha)) fail('run_unverified');
  if (event?.inputs?.operation === 'initialize') return initializeAnchor(client, config, run, event);
  let state = await recoverAnchor(client, config, await readSnapshot(client, config));
  const reviewApi = review ?? await import('./agent-review.mjs');
  const handled = (snapshot, comment) => Object.values(snapshot.requests).some((record) => record.request_comment_id === comment.id || record.deliveries?.some((delivery) => delivery.request_comment_id === comment.id));
  const unhandled = state.request_comments.filter((comment) => !handled(state, comment));
  const authorized = (comment) => config.actor_ids.request.includes(comment.author_id) && uneditedComment(comment);
  const pending = unhandled.filter(authorized).sort((a, b) => a.id - b.id);
  const skipped = unhandled.length - pending.length;
  let processed = 0;
  let rejected = 0;
  let interrupted = false;
  const errors = [];
  for (const comment of pending.slice(0, config.limits.requests_per_run)) {
    try {
      let request = null;
      try { request = parseRequestComment(comment.body, { maxBytes: config.limits.request_bytes }); } catch (error) {
        if (!(error instanceof DelegationError)) throw error;
      }
      if (request === null) {
        // 不正本文を保存せず、コメント単位の一般的な拒否だけを記録する。
        const digest = hashJson({ repository_id: config.repository_id, request_comment_id: comment.id, operation: 'request-rejected' });
        const requestId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
        const meta = { ...systemMeta(run, 'request-rejected'), request_id: requestId, request_comment_id: comment.id, request_hash: digest };
        state = await persistEvent(client, config, state, {}, meta, { code: 'request_rejected', allowed: false });
        rejected += 1;
        errors.push({ request_comment_id: comment.id, code: 'request_rejected' });
      } else {
        state = await processRequest(client, config, state, run, comment, request, { now, uuid, review: reviewApi });
        processed += 1;
      }
    } catch (error) {
      errors.push({ request_comment_id: comment.id, code: publicError(error) });
      // 途中の追記だけが保存された場合も、残件数は読み直した受付履歴で数える。
      try { state = await readSnapshot(client, config); } catch { /* 不明な受付は残件に含める。 */ }
      interrupted = true;
      break;
    }
  }
  const result = () => ({ processed, rejected, skipped, interrupted, remaining: pending.filter((comment) => !handled(state, comment)).length, errors, seq: state.seq, state });
  if (interrupted) return result();
  state = await reconcileTasks(client, config, state, run, now, uuid);
  const numbers = await notificationPrs(client, config, event);
  const shas = new Set();
  for (const number of numbers) {
    const current = await verifyPr(client, config, number);
    if (state.prs[number]?.head_sha) shas.add(state.prs[number].head_sha);
    shas.add(current.head_sha);
    const task = Object.values(state.tasks).find((item) => item.pr === number);
    const changes = { prs: { [number]: { ...state.prs[number], pr: number, head_sha: current.head_sha, state: current.pr_state, target: state.prs[number]?.target ?? false } } };
    if (task) changes.tasks = { [task.task_key]: { ...task, state: current.pr_state === 'OPEN' ? 'pr_open' : 'finalized' } };
    state = await persistEvent(client, config, state, changes, systemMeta(run, 'pr-observed'), { code: 'pr_observed', allowed: false });
  }
  if (run.event === 'schedule' || event?.inputs?.operation === 'reconcile') {
    const open = await client.paginate(`/repos/${config.repository}/pulls?state=open`, { maxPages: config.limits.max_pages, maxItems: config.limits.open_prs });
    for (const pr of open) shas.add(pr.head.sha);
    for (const pr of Object.values(state.prs)) if (pr.head_sha) shas.add(pr.head_sha);
  }
  for (const sha of shas) state = await refreshSha(client, config, state, run, sha, reviewApi);
  return result();
}

/** 初期化の再実行は既存anchorの照合だけに限る。 */
export async function initializeAnchor(client, config, run, event) {
  if (run.event !== 'workflow_dispatch' || !config.actor_ids.request.includes(event?.sender?.id) || !config.actor_ids.request.includes(run.triggering_actor?.id)) fail('initialize_unauthorized');
  const issue = await client.rest('GET', `/repos/${config.repository}/issues/${config.management_issue}`);
  if (issue?.number !== config.management_issue || issue.pull_request) fail('initialize_unverified');
  const list = () => readIssueComments(client, config);
  const isAnchor = (comment) => comment.author_id === config.actor_ids.actions && comment.body?.startsWith(`${ANCHOR_MARKER}\n`);
  const existing = (await list()).filter(isAnchor);
  if (existing.length > 1) fail('anchor_conflict');
  if (existing.length === 1) {
    const state = await readSnapshot(client, { ...config, anchor_comment_id: existing[0].id });
    return { code: 'anchor_initialized', anchor_comment_id: existing[0].id, seq: state.seq, hash: state.hash };
  }
  const priorRuns = await client.paginate(`/repos/${config.repository}/actions/workflows/${config.controller_workflow_id}/runs?event=workflow_dispatch`, { key: 'workflow_runs', maxPages: config.limits.max_pages, maxItems: 1000 });
  if (run.run_attempt !== 1 || priorRuns.some((prior) => prior.id !== run.id)) fail('initialize_unknown');
  const pointer = { schema_version: 1, last_seq: 0, last_event_id: null, last_hash: ZERO_HASH };
  let comment = null;
  try { comment = await client.rest('POST', `/repos/${config.repository}/issues/${config.management_issue}/comments`, { body: formatAnchor(pointer) }); } catch {
    const observed = (await list()).filter(isAnchor);
    if (observed.length !== 1) fail('initialize_unknown');
    comment = observed[0];
  }
  if (!positive(comment?.id)) fail('initialize_unknown');
  const state = await readSnapshot(client, { ...config, anchor_comment_id: comment.id });
  if (state.seq !== 0 || state.hash !== ZERO_HASH) fail('anchor_conflict');
  return { code: 'anchor_initialized', anchor_comment_id: comment.id, seq: 0, hash: ZERO_HASH };
}

export async function runControllerMain({ env = process.env, config = null, event = null, client = null, review = null, output = console.log } = {}) {
  if (env.GITHUB_ACTIONS !== 'true') fail('controller_only');
  config ??= JSON.parse(readFileSync(new URL('../config/delegation-review.json', import.meta.url), 'utf8'));
  if (env.GITHUB_REPOSITORY !== config.repository) fail('repository_unverified');
  event ??= JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  client ??= createGitHubClient({ repo: config.repository, maxApiCalls: config.limits.api_calls, timeoutMs: config.limits.timeout_ms, jobTimeoutMs: config.limits.job_timeout_ms });
  if (!/^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? '')) fail('run_unverified');
  const result = await runController({ client, config, runId: Number(env.GITHUB_RUN_ID), runAttempt: Number(env.GITHUB_RUN_ATTEMPT), runtimeSha: env.GITHUB_SHA, event, review });
  output(canonicalJson(result.code === 'anchor_initialized' ? result : { processed: result.processed, rejected: result.rejected, skipped: result.skipped, interrupted: result.interrupted, remaining: result.remaining, errors: result.errors, seq: result.seq }));
  return result.interrupted === true ? 5 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runControllerMain().then((code) => { process.exitCode = code; }).catch((error) => { console.error(new DelegationError(publicError(error)).message); process.exitCode = error instanceof DelegationError ? error.exit_code : 5; });
}
