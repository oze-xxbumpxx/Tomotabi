import { createHash, randomUUID } from 'node:crypto';

export const REQUEST_MARKER = '<!-- tomotabi-delegation-request -->';
export const EVENT_MARKER = '<!-- tomotabi-delegation-event -->';
export const ANCHOR_MARKER = '<!-- tomotabi-delegation-head -->';
export const TASK_MARKER = '<!-- tomotabi-delegation-task -->';
export const ZERO_HASH = '0'.repeat(64);
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const KEY = /^[a-z0-9-]{1,64}:[a-z0-9-]{1,64}$/;
const MODEL = /^(?:swe-2-(?:medium|high|max)|unknown)$/;
const RUN_CACHE = new WeakMap();
const PROVENANCE_CACHE = new WeakMap();
const RUN_LIST_CACHE = new WeakMap();
const BASE = ['schema_version', 'operation', 'request_id'];
const FIELDS = {
  register: ['task_key', 'plan_path', 'plan_sha', 'task_digest', 'wave', 'start_conditions_confirmed'],
  claim: ['task_key', 'task_digest', 'caller_id', 'runner', 'requested_model'],
  begin: ['task_key', 'attempt_id', 'caller_id', 'activation_id'],
  started: ['task_key', 'attempt_id', 'caller_id', 'activation_id', 'session_id', 'session_url', 'observed_model'],
  'link-pr': ['task_key', 'pr'],
  import: ['task_key', 'task_digest', 'plan_path', 'plan_sha', 'issue', 'pr', 'attempt_id', 'caller_id', 'activation_id', 'runner', 'requested_model', 'observed_model', 'session_id', 'session_url', 'state', 'start_conditions_confirmed'],
  reconcile: ['task_key'],
  'review-refresh': ['pr'],
};
const TASK_FIELDS = new Set(['task_key', 'task_digest', 'plan_path', 'plan_sha', 'wave', 'state', 'issue', 'issue_attempt_id', 'attempt_id', 'caller_id', 'activation_id', 'runner', 'requested_model', 'observed_model', 'session_id', 'session_url', 'pr', 'reserved_at', 'start_conditions_confirmed', 'updated_seq']);
const TASK_STATES = new Set(['registered', 'issue_creating', 'issue_unknown', 'issue_ready', 'reserved', 'launching', 'launch_unknown', 'running', 'pr_open', 'finalized', 'withdrawn']);

export class DelegationError extends Error {
  constructor(code) {
    super(`委譲の状態を確認できません（${code}）`);
    this.name = 'DelegationError';
    this.code = code;
    this.exit_code = /invalid|conflict|unauthorized/.test(code) ? 2 : /unknown/.test(code) ? 4 : /pending/.test(code) ? 3 : 5;
  }
}

const fail = (code) => { throw new DelegationError(code); };
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const positive = (v) => Number.isSafeInteger(v) && v > 0;

export function canonicalJson(value) {
  function normalize(v) {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number') {
      if (!Number.isSafeInteger(v)) fail('invalid_number');
      return v;
    }
    if (Array.isArray(v)) return v.map(normalize);
    if (!object(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) fail('invalid_json');
    return Object.fromEntries(Object.keys(v).sort().map((key) => {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('invalid_json_key');
      return [key, normalize(v[key])];
    }));
  }
  return JSON.stringify(normalize(value));
}

export const hashJson = (value) => createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
export const taskDigest = (text) => createHash('sha256').update(text.replace(/\r\n?/g, '\n'), 'utf8').digest('hex');
const clone = (value) => JSON.parse(canonicalJson(value));

function parseMarked(body, marker, bytes) {
  if (typeof body !== 'string' || !body.startsWith(`${marker}\n`)) return null;
  if (Buffer.byteLength(body, 'utf8') > bytes + Buffer.byteLength(marker) + 1) fail('input_limit');
  try {
    const parsed = JSON.parse(body.slice(marker.length + 1));
    if (!object(parsed)) fail('invalid_json');
    canonicalJson(parsed);
    return parsed;
  } catch (error) {
    if (error instanceof DelegationError) throw error;
    fail('invalid_json');
  }
}

export function validateRequest(request, { maxBytes = 8192 } = {}) {
  if (!object(request) || request.schema_version !== 1 || !UUID.test(request.request_id ?? '') || !Object.hasOwn(FIELDS, request.operation)) fail('invalid_request');
  const allowed = new Set([...BASE, ...FIELDS[request.operation]]);
  if (Object.keys(request).some((key) => !allowed.has(key))) fail('invalid_request_field');
  if (Buffer.byteLength(canonicalJson(request), 'utf8') > maxBytes) fail('request_limit');
  const required = {
    register: ['task_key', 'plan_path', 'plan_sha', 'task_digest'],
    claim: ['task_key', 'task_digest', 'caller_id', 'runner', 'requested_model'],
    begin: ['attempt_id', 'caller_id', 'activation_id'],
    started: ['attempt_id', 'caller_id', 'activation_id', 'session_id', 'session_url', 'observed_model'],
    'link-pr': ['task_key', 'pr'], import: ['task_key', 'task_digest'], reconcile: [], 'review-refresh': ['pr'],
  }[request.operation];
  if (required.some((key) => !Object.hasOwn(request, key))) fail('invalid_request_missing');
  if (request.task_key !== undefined && !KEY.test(request.task_key)) fail('invalid_task_key');
  if (request.plan_path !== undefined && request.plan_path !== `docs/implementation-plans/${request.task_key?.split(':')[0]}.md`) fail('invalid_plan_path');
  if (request.plan_sha !== undefined && !SHA.test(request.plan_sha)) fail('invalid_plan_sha');
  if (request.task_digest !== undefined && !HASH.test(request.task_digest)) fail('invalid_task_digest');
  for (const field of ['caller_id', 'attempt_id', 'activation_id']) {
    if (request[field] !== undefined && request[field] !== null && !UUID.test(request[field])) fail('invalid_identity');
    if (required.includes(field) && request[field] === null) fail('invalid_identity');
  }
  for (const field of ['issue', 'pr']) if (request[field] !== undefined && request[field] !== null && !positive(request[field])) fail('invalid_number');
  if (request.runner !== undefined && !['local', 'cloud'].includes(request.runner)) fail('invalid_runner');
  for (const field of ['requested_model', 'observed_model']) if (request[field] !== undefined && !MODEL.test(request[field])) fail('invalid_model');
  if (request.start_conditions_confirmed !== undefined && typeof request.start_conditions_confirmed !== 'boolean') fail('invalid_start_conditions');
  if (request.wave !== undefined && !(typeof request.wave === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(request.wave))) fail('invalid_wave');
  if (request.state !== undefined && !TASK_STATES.has(request.state)) fail('invalid_state');
  if (request.session_id !== undefined && request.session_id !== null && !/^[a-zA-Z0-9_-]{1,128}$/.test(request.session_id)) fail('invalid_session');
  if (request.session_url !== undefined && request.session_url !== null && !/^https:\/\/app\.devin\.ai\/sessions\/[a-zA-Z0-9_-]{1,128}\/?$/.test(request.session_url)) fail('invalid_session_url');
  return clone(request);
}

export function parseRequestComment(body, options = {}) {
  const parsed = parseMarked(body, REQUEST_MARKER, options.maxBytes ?? 8192);
  return parsed === null ? null : validateRequest(parsed, options);
}

export const formatRequestComment = (request) => `${REQUEST_MARKER}\n${canonicalJson(validateRequest(request))}`;
export const formatAnchor = (pointer) => `${ANCHOR_MARKER}\n${canonicalJson(pointer)}`;

export function extractPlanTask(plan, taskKey) {
  if (!KEY.test(taskKey ?? '') || typeof plan !== 'string') fail('invalid_plan');
  const task = taskKey.split(':')[1];
  const text = plan.replace(/\r\n?/g, '\n');
  const start = `<!-- delegation-task:${task} -->`;
  const offsets = [...text.matchAll(new RegExp(start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].map((match) => match.index);
  if (offsets.length !== 1) fail('plan_task_conflict');
  const from = offsets[0] + start.length;
  const to = text.indexOf('<!-- /delegation-task -->', from);
  if (to < 0 || text.slice(from, to).includes('<!-- delegation-task:')) fail('invalid_plan_task');
  const body = text.slice(from, to).replace(/^\n/, '').replace(/\n$/, '');
  if (body.trim() === '') fail('invalid_plan_task');
  return { body, task_digest: taskDigest(body) };
}

export const emptyState = () => ({ schema_version: 1, seq: 0, hash: ZERO_HASH, tasks: {}, requests: {}, prs: {}, checks: {} });

export function applyChanges(state, changes) {
  if (!object(changes) || Object.keys(changes).some((key) => !['tasks', 'requests', 'prs', 'checks'].includes(key))) fail('invalid_event_changes');
  const next = clone(state);
  for (const key of ['tasks', 'requests', 'prs', 'checks']) {
    if (changes[key] === undefined) continue;
    if (!object(changes[key])) fail('invalid_event_changes');
    for (const [id, value] of Object.entries(changes[key])) {
      if (!object(value)) fail('invalid_event_changes');
      if (key === 'tasks' && (!KEY.test(id) || value.task_key !== id || !TASK_STATES.has(value.state) || Object.keys(value).some((field) => !TASK_FIELDS.has(field)))) fail('invalid_event_task');
      if (key === 'requests' && !UUID.test(id)) fail('invalid_event_request');
      if (key === 'prs' && !/^\d+$/.test(id)) fail('invalid_event_pr');
      if (key === 'checks' && !SHA.test(id)) fail('invalid_event_check');
      next[key][id] = clone(value);
    }
  }
  return next;
}

export function createJournalEvent(state, changes, meta, result, { maxBytes = 49152 } = {}) {
  const event = {
    schema_version: 1, seq: state.seq + 1, prev_hash: state.hash,
    source_run_id: meta.source_run_id, source_run_attempt: meta.source_run_attempt,
    request_comment_id: meta.request_comment_id ?? null, request_id: meta.request_id ?? null,
    operation: meta.operation, changes: clone(changes), result: clone(result),
  };
  for (const task of Object.values(event.changes.tasks ?? {})) task.updated_seq = event.seq;
  if (!positive(event.source_run_id) || !positive(event.source_run_attempt) || typeof event.operation !== 'string') fail('invalid_event_source');
  if (event.request_id !== null && !UUID.test(event.request_id)) fail('invalid_event_request');
  if (event.request_comment_id !== null && !positive(event.request_comment_id)) fail('invalid_event_request');
  if (meta.request_id !== null && meta.request_id !== undefined) {
    event.changes.requests ??= {};
    const existing = state.requests[meta.request_id] ?? {};
    event.changes.requests[meta.request_id] = {
      ...existing, ...(event.changes.requests[meta.request_id] ?? {}),
      request_hash: meta.request_hash, operation: meta.operation, result: clone(result),
      request_comment_id: meta.request_comment_id, source_run_id: meta.source_run_id,
      source_run_attempt: meta.source_run_attempt,
    };
  }
  applyChanges(state, event.changes);
  event.hash = hashJson(event);
  if (Buffer.byteLength(canonicalJson(event), 'utf8') > maxBytes) fail('event_limit');
  return event;
}

export function verifyJournal(entries, pointer) {
  if (!object(pointer) || pointer.schema_version !== 1 || !Number.isSafeInteger(pointer.last_seq) || pointer.last_seq < 0 || !HASH.test(pointer.last_hash ?? '')) fail('anchor_corrupt');
  let state = emptyState();
  const ordered = [...entries].sort((a, b) => a.event.seq - b.event.seq);
  for (const { event, comment_id } of ordered) {
    const { hash, ...unhashed } = event;
    if (event.schema_version !== 1 || event.seq !== state.seq + 1 || event.prev_hash !== state.hash || hashJson(unhashed) !== hash || !positive(comment_id)) fail('journal_corrupt');
    state = applyChanges(state, event.changes);
    state.seq = event.seq;
    state.hash = event.hash;
  }
  const anchorEntry = ordered.find((entry) => entry.event.seq === pointer.last_seq);
  if (pointer.last_seq === 0) {
    if (pointer.last_hash !== ZERO_HASH || pointer.last_event_id !== null) fail('anchor_corrupt');
  } else if (!anchorEntry || anchorEntry.comment_id !== pointer.last_event_id || anchorEntry.event.hash !== pointer.last_hash) fail('anchor_mismatch');
  if (pointer.last_seq > state.seq) fail('journal_missing');
  const tail = ordered.at(-1);
  return { ...state, pointer: clone(pointer), events: ordered, recovery: state.seq > pointer.last_seq,
    recovered_pointer: { schema_version: 1, last_seq: state.seq, last_event_id: tail?.comment_id ?? null, last_hash: state.hash } };
}

export function reduceRequest(state, rawRequest, context = {}) {
  const request = validateRequest(rawRequest, { maxBytes: context.config?.limits?.request_bytes ?? 8192 });
  const requestHash = hashJson(request);
  const previous = state.requests[request.request_id];
  if (previous) {
    if (previous.request_hash !== requestHash) return { changes: {}, result: { code: 'request_conflict', allowed: false }, replay: true };
    return { changes: {}, result: request.operation === 'begin' ? { code: 'already_begun', allowed: false, first_delivery: false } : { ...clone(previous.result), allowed: false }, replay: true };
  }
  const config = context.config ?? {};
  if (['claim', 'begin', 'reconcile'].includes(request.operation) && Number.isNaN(Date.parse(context.now))) fail('invalid_time');
  if (['register', 'claim', 'begin'].includes(request.operation) && config.migration_complete !== true) fail('migration_pending');
  if (['claim', 'begin'].includes(request.operation) && config.cli_launch_verified !== true) fail('launch_unverified');
  const changes = {};
  let result = { code: 'confirmed', allowed: false };
  const task = request.task_key ? state.tasks[request.task_key] : Object.values(state.tasks).find((item) => item.attempt_id === request.attempt_id);
  const setTask = (next) => { changes.tasks = { [next.task_key]: next }; };
  if (request.operation === 'register') {
    if (task) {
      if (task.task_digest !== request.task_digest || task.state === 'withdrawn') fail('content_conflict');
      result = { code: 'already_registered', task_key: task.task_key, issue: task.issue ?? null, allowed: false };
    } else {
      if (Object.keys(state.tasks).length >= (config.limits?.tasks ?? 100)) fail('task_limit');
      if (context.plan_verified !== true) fail('plan_unverified');
      setTask({
        task_key: request.task_key, task_digest: request.task_digest, plan_path: request.plan_path, plan_sha: request.plan_sha,
        wave: request.wave ?? null, state: 'registered', issue: null, pr: null,
        start_conditions_confirmed: request.start_conditions_confirmed === true,
      });
      result = { code: 'registered', task_key: request.task_key, allowed: false };
    }
  } else if (request.operation === 'claim') {
    if (!task || task.task_digest !== request.task_digest) fail('content_conflict');
    if (task.state === 'reserved' && task.caller_id === request.caller_id) {
      if (task.runner !== request.runner || task.requested_model !== request.requested_model) fail('configuration_conflict');
      result = { code: 'already_reserved', attempt_id: task.attempt_id, caller_id: task.caller_id, task_key: task.task_key, allowed: false };
    }
    else {
      if (task.state !== 'issue_ready' || !positive(task.issue) || task.start_conditions_confirmed !== true || context.issue_verified !== true) fail('claim_unavailable');
      if (!UUID.test(context.attempt_id ?? '')) fail('invalid_identity');
      setTask({ ...task, state: 'reserved', attempt_id: context.attempt_id, caller_id: request.caller_id,
        runner: request.runner, requested_model: request.requested_model, observed_model: 'unknown', activation_id: null,
        session_id: null, session_url: null, reserved_at: context.now });
      result = { code: 'reserved', attempt_id: context.attempt_id, caller_id: request.caller_id, task_key: task.task_key, allowed: false };
    }
  } else if (request.operation === 'begin') {
    if (!task || task.attempt_id !== request.attempt_id || task.caller_id !== request.caller_id) fail('unauthorized_attempt');
    if (task.state !== 'reserved') result = { code: 'already_begun', allowed: false, first_delivery: false, attempt_id: task.attempt_id };
    else if (Date.parse(context.now) - Date.parse(task.reserved_at) >= 900_000) {
      setTask({ ...task, state: 'launch_unknown' });
      result = { code: 'launch_unknown', allowed: false, first_delivery: false };
    } else {
      setTask({ ...task, state: 'launching', activation_id: request.activation_id });
      result = { code: 'begin_allowed', allowed: true, first_delivery: true, attempt_id: task.attempt_id,
        caller_id: task.caller_id, activation_id: request.activation_id, task_key: task.task_key };
    }
  } else if (request.operation === 'started') {
    if (!task || task.attempt_id !== request.attempt_id || task.caller_id !== request.caller_id || task.activation_id !== request.activation_id || !['launching', 'launch_unknown', 'running'].includes(task.state)) fail('unauthorized_attempt');
    if (task.state === 'running' && request.session_id !== task.session_id) fail('session_conflict');
    const known = typeof request.session_id === 'string' && typeof request.session_url === 'string' &&
      request.session_url.replace(/\/$/, '').split('/').at(-1) === request.session_id && context.session_verified === true;
    setTask({ ...task, state: known ? 'running' : 'launch_unknown', session_id: known ? request.session_id : null,
      session_url: known ? request.session_url : null, observed_model: known ? request.observed_model : 'unknown' });
    result = { code: known ? 'running' : 'launch_unknown', allowed: false, attempt_id: task.attempt_id, caller_id: task.caller_id, activation_id: task.activation_id };
  } else if (request.operation === 'link-pr') {
    if (!task || context.link_verified !== true) fail('pr_unverified');
    if (task.pr !== null && task.pr !== undefined && task.pr !== request.pr) fail('pr_conflict');
    setTask({ ...task, pr: request.pr, state: context.pr_state === 'OPEN' ? 'pr_open' : 'finalized' });
    changes.prs = { [request.pr]: { ...(state.prs[request.pr] ?? {}), pr: request.pr, task_key: task.task_key, target: true, head_sha: context.head_sha, state: context.pr_state } };
    result = { code: 'linked', pr: request.pr, allowed: false };
  } else if (request.operation === 'import') {
    if (context.import_verified !== true) fail('import_unverified');
    if (task && (task.task_digest !== request.task_digest || (task.issue && task.issue !== request.issue) || (task.pr && task.pr !== request.pr))) fail('content_conflict');
    if (!task && Object.keys(state.tasks).length >= (config.limits?.tasks ?? 100)) fail('task_limit');
    const imported = Object.fromEntries(Object.entries(request).filter(([key]) => TASK_FIELDS.has(key)));
    setTask({ ...task, ...imported, state: request.state ?? (request.pr ? 'pr_open' : request.session_id ? 'running' : 'launch_unknown'), issue: request.issue ?? task?.issue ?? null, pr: request.pr ?? task?.pr ?? null });
    if (request.pr) changes.prs = { [request.pr]: { pr: request.pr, task_key: request.task_key, target: true, head_sha: context.head_sha, state: context.pr_state } };
    result = { code: 'imported', task_key: request.task_key, allowed: false };
  } else if (request.operation === 'reconcile') {
    if (task && ['reserved', 'launching'].includes(task.state) && Date.parse(context.now) - Date.parse(task.reserved_at) >= 900_000) setTask({ ...task, state: 'launch_unknown' });
    result = { code: 'reconciled', allowed: false };
  } else if (request.operation === 'review-refresh') result = { code: 'review_pending', pr: request.pr, allowed: false };
  return { changes, result, request_hash: requestHash, replay: false };
}

function initialized(config) {
  return config?.schema_version === 1 && positive(config.management_issue) && positive(config.anchor_comment_id) && positive(config.controller_workflow_id);
}

const ACTOR_FIELDS = '__typename ... on User{databaseId} ... on Bot{databaseId}';
const dateTime = (value) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const actorId = (actor) => actor === null ? null : ['User', 'Bot'].includes(actor?.__typename) && positive(actor.databaseId) ? actor.databaseId : -1;

/** 本文と作者・最終編集情報を同じGraphQL応答から読み、REST時刻だけでは未編集としない。 */
export async function readIssueComments(client, config) {
  const [owner, name] = config.repository.split('/');
  const pageSize = config.limits?.page_size ?? 100;
  const maxPages = config.limits?.max_pages ?? 10;
  const maxItems = config.limits?.comments ?? 1000;
  if (![pageSize, maxPages, maxItems].every(positive) || pageSize > 100) fail('comment_limit');
  const comments = [];
  const ids = new Set();
  const cursors = new Set();
  let cursor = null;
  for (let page = 0; page < maxPages; page += 1) {
    let response = null;
    try {
      response = await client.graphql(`query($owner:String!,$name:String!,$number:Int!,$first:Int!,$cursor:String){repository(owner:$owner,name:$name){databaseId issue(number:$number){number comments(first:$first,after:$cursor){nodes{databaseId fullDatabaseId body createdAt updatedAt author{${ACTOR_FIELDS}} editor{${ACTOR_FIELDS}} lastEditedAt}pageInfo{hasNextPage endCursor}}}}}`, { owner, name, number: config.management_issue, first: pageSize, cursor });
    } catch { fail('comments_unknown'); }
    const repo = response?.repository;
    const issue = repo?.issue;
    const connection = issue?.comments;
    if (repo?.databaseId !== config.repository_id || issue?.number !== config.management_issue || !Array.isArray(connection?.nodes) || typeof connection.pageInfo?.hasNextPage !== 'boolean' || connection.nodes.length > pageSize) fail('comments_unknown');
    for (const node of connection.nodes) {
      const id = node?.fullDatabaseId === null || node?.fullDatabaseId === undefined ? node?.databaseId : /^\d+$/.test(String(node.fullDatabaseId)) ? Number(node.fullDatabaseId) : null;
      if (!positive(id) || ids.has(id) || typeof node.body !== 'string' || !dateTime(node.createdAt) || !dateTime(node.updatedAt) || !Object.hasOwn(node, 'author') || !Object.hasOwn(node, 'editor') || !Object.hasOwn(node, 'lastEditedAt') || (node.lastEditedAt !== null && !dateTime(node.lastEditedAt))) fail('comments_unknown');
      ids.add(id);
      comments.push({ id, body: node.body, user: { id: actorId(node.author) }, author_id: actorId(node.author), editor_id: actorId(node.editor), last_edited_at: node.lastEditedAt, created_at: node.createdAt, updated_at: node.updatedAt });
    }
    if (comments.length >= maxItems) fail('comment_limit');
    if (!connection.pageInfo.hasNextPage) return comments;
    if (connection.nodes.length === 0 || typeof connection.pageInfo.endCursor !== 'string' || connection.pageInfo.endCursor === '' || cursors.has(connection.pageInfo.endCursor)) fail('comments_unknown');
    cursor = connection.pageInfo.endCursor;
    cursors.add(cursor);
  }
  fail('comment_limit');
}

export const uneditedComment = (comment) => comment.last_edited_at === null && comment.editor_id === null && comment.created_at === comment.updated_at;

export async function verifyControlRun(client, config, runId, runAttempt) {
  if (!positive(runId) || !positive(runAttempt)) fail('run_unverified');
  const key = `${config.repository_id}:${config.controller_workflow_id}:${runId}:${runAttempt}`;
  let cache = RUN_CACHE.get(client);
  if (!cache) { cache = new Map(); RUN_CACHE.set(client, cache); }
  if (cache.has(key)) return clone(cache.get(key));
  const run = RUN_LIST_CACHE.get(client)?.find((item) => item.id === runId && item.run_attempt === runAttempt) ??
    await client.rest('GET', `/repos/${config.repository}/actions/runs/${runId}/attempts/${runAttempt}`);
  if (run?.repository?.id !== config.repository_id || run?.head_repository?.id !== config.repository_id ||
    run.workflow_id !== config.controller_workflow_id || run.head_branch !== config.default_branch ||
    !config.allowed_controller_events?.includes(run.event) || run.run_attempt !== runAttempt || !SHA.test(run.head_sha ?? '')) fail('run_unverified');
  let provenance = PROVENANCE_CACHE.get(client);
  if (!provenance) { provenance = { workflows: new Map(), branches: new Map(), commits: new Set() }; PROVENANCE_CACHE.set(client, provenance); }
  const workflowKey = `${config.repository}:${run.workflow_id}`;
  let workflow = provenance.workflows.get(workflowKey);
  if (!workflow) { workflow = await client.rest('GET', `/repos/${config.repository}/actions/workflows/${run.workflow_id}`); provenance.workflows.set(workflowKey, workflow); }
  if (workflow?.path !== config.controller_workflow_path) fail('workflow_unverified');
  await verifyMainCommit(client, config, run.head_sha);
  cache.set(key, run);
  return clone(run);
}

export async function verifyMainCommit(client, config, sha) {
  if (!SHA.test(sha ?? '')) fail('commit_unverified');
  let provenance = PROVENANCE_CACHE.get(client);
  if (!provenance) { provenance = { workflows: new Map(), branches: new Map(), commits: new Set() }; PROVENANCE_CACHE.set(client, provenance); }
  const key = `${config.repository}:${config.default_branch}`;
  const commitKey = `${key}:${sha}`;
  if (provenance.commits.has(commitKey)) return;
  let branch = provenance.branches.get(key);
  if (!branch) { branch = await client.rest('GET', `/repos/${config.repository}/branches/${config.default_branch}`); provenance.branches.set(key, branch); }
  if (branch?.protected !== true || !SHA.test(branch.commit?.sha ?? '')) fail('main_unprotected');
  const comparison = await client.rest('GET', `/repos/${config.repository}/compare/${sha}...${branch.commit.sha}`);
  if (!['ahead', 'identical'].includes(comparison?.status)) fail('commit_unverified');
  provenance.commits.add(commitKey);
}

export async function readSnapshot(client, config) {
  if (!initialized(config)) fail('uninitialized');
  const repo = await client.rest('GET', `/repos/${config.repository}`);
  if (repo?.id !== config.repository_id || repo.default_branch !== config.default_branch) fail('repository_unverified');
  const comments = await readIssueComments(client, config);
  const anchorComment = comments.find((comment) => comment.id === config.anchor_comment_id);
  if (!anchorComment) fail('anchor_missing');
  if (anchorComment.author_id !== config.actor_ids?.actions || (anchorComment.last_edited_at === null ? !uneditedComment(anchorComment) : anchorComment.editor_id !== config.actor_ids.actions)) fail('anchor_author_unverified');
  const pointer = parseMarked(anchorComment.body, ANCHOR_MARKER, config.limits?.event_bytes ?? 49152);
  if (!pointer) fail('anchor_corrupt');
  const entries = [];
  const journalComments = comments.filter((comment) => comment.author_id === config.actor_ids?.actions && comment.body?.startsWith(`${EVENT_MARKER}\n`));
  const sourceEvents = journalComments.map((comment) => {
    if (!uneditedComment(comment)) fail('journal_author_unverified');
    return { event: parseMarked(comment.body, EVENT_MARKER, config.limits?.event_bytes ?? 49152), comment_id: comment.id };
  });
  const knownRuns = RUN_CACHE.get(client) ?? new Map();
  if (sourceEvents.some(({ event }) => !knownRuns.has(`${config.repository_id}:${config.controller_workflow_id}:${event.source_run_id}:${event.source_run_attempt}`)) && !RUN_LIST_CACHE.has(client)) {
    const runs = await client.paginate(`/repos/${config.repository}/actions/workflows/${config.controller_workflow_id}/runs`, { key: 'workflow_runs', maxPages: config.limits?.max_pages ?? 10, maxItems: config.limits?.comments ?? 1000 });
    RUN_LIST_CACHE.set(client, runs);
  }
  for (const entry of sourceEvents) {
    const { event } = entry;
    await verifyControlRun(client, config, event.source_run_id, event.source_run_attempt);
    entries.push(entry);
  }
  const snapshot = verifyJournal(entries, pointer);
  return { ...snapshot, fetched_at: new Date().toISOString(), request_comments: comments.filter((comment) => comment.body?.startsWith(`${REQUEST_MARKER}\n`)) };
}

export async function submitRequest(client, config, request) {
  const validated = validateRequest(request, { maxBytes: config.limits?.request_bytes ?? 8192 });
  await readSnapshot(client, config);
  if (['register', 'claim', 'begin'].includes(request.operation) && config.migration_complete !== true) fail('migration_pending');
  const comment = await client.rest('POST', `/repos/${config.repository}/issues/${config.management_issue}/comments`, { body: formatRequestComment(validated) });
  if (!positive(comment?.id)) fail('delivery_unknown');
  return { request_id: validated.request_id, request_comment_id: comment.id, request_hash: hashJson(validated) };
}

export async function waitForResult(client, config, {
  requestId, commentId, activationId = null, timeoutMs = config.limits?.wait_ms ?? 120_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), clock = Date.now,
} = {}) {
  if (!UUID.test(requestId ?? '') || !positive(commentId)) fail('invalid_receipt');
  const deadline = clock() + timeoutMs;
  for (;;) {
    const state = await readSnapshot(client, config);
    const record = state.requests[requestId];
    if (record) {
      const event = [...state.events].reverse().find((entry) => entry.event.request_id === requestId);
      if (!event || event.event.seq > state.pointer.last_seq) fail('result_pending');
      const result = { ...clone(record.result), request_id: requestId, request_comment_id: commentId, source_run_id: record.source_run_id,
        source_run_attempt: record.source_run_attempt, event_hash: event.event.hash };
      if (record.request_comment_id !== commentId) {
        const delivery = record.deliveries?.find((item) => item.request_comment_id === commentId);
        if (!delivery) fail('result_pending');
        if (delivery.code === 'request_conflict') return { ...result, code: 'request_conflict', allowed: false, first_delivery: false };
        if (record.operation === 'begin') return { ...result, code: 'already_begun', allowed: false, first_delivery: false };
        result.allowed = false;
        result.first_delivery = false;
      }
      if (activationId !== null && (result.activation_id !== activationId || result.code !== 'begin_allowed')) return { ...result, allowed: false, first_delivery: false };
      if (!['registered', 'issue_creating', 'review_pending'].includes(result.code)) return result;
    }
    if (clock() >= deadline) fail('result_pending');
    await sleep(Math.min(1000, Math.max(0, deadline - clock())));
  }
}

export const newRequestId = () => randomUUID();
