#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, writeFileSync, fsyncSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CLONE } from './devin-watch.mjs';
import { resolveStateDir } from '../lib/harness-paths.mjs';

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const TASK = /^[a-z0-9-]{1,64}:[a-z0-9-]{1,64}$/;
const MODELS = ['swe-2-medium', 'swe-2-high', 'swe-2-max'];
const CONFIG = join(dirname(fileURLToPath(import.meta.url)), '../config/delegation-review.json');

export function parseLaunchArgs(argv) {
  const [taskKey, ...args] = argv;
  const options = { taskKey, runner: null, model: null, promptFile: null, callerId: null, clone: null };
  for (let i = 0; i < args.length; i += 2) {
    const field = { '--runner': 'runner', '--model': 'model', '--prompt-file': 'promptFile', '--caller-id': 'callerId', '--clone': 'clone' }[args[i]];
    if (field === undefined || args[i + 1] === undefined || options[field] !== null) throw new Error('起動引数を確認してください');
    options[field] = args[i + 1];
  }
  if (!TASK.test(taskKey ?? '') || !['local', 'cloud'].includes(options.runner) || !MODELS.includes(options.model) || !options.promptFile || (options.callerId !== null && !UUID.test(options.callerId))) {
    throw new Error('task_key、runner、model、非公開prompt fileが必要です');
  }
  return options;
}

export function consumeBeginReceipt(receipt, expected) {
  if (!receipt || receipt.code !== 'begin_allowed' || receipt.allowed !== true || receipt.first_delivery !== true) return false;
  const pairs = [['request_id', 'requestId'], ['request_comment_id', 'commentId'], ['attempt_id', 'attemptId'], ['caller_id', 'callerId'], ['activation_id', 'activationId']];
  if (!pairs.every(([field, key]) => receipt[field] === expected[key])) return false;
  if (!Number.isSafeInteger(receipt.source_run_id) || receipt.source_run_id <= 0 || !Number.isSafeInteger(receipt.source_run_attempt) || receipt.source_run_attempt <= 0 || !/^[0-9a-f]{64}$/.test(receipt.event_hash ?? '')) return false;
  if (expected.sourceRunId !== undefined && receipt.source_run_id !== expected.sourceRunId) return false;
  if (expected.sourceRunAttempt !== undefined && receipt.source_run_attempt !== expected.sourceRunAttempt) return false;
  return true;
}

export function reserveSpent(stateDir, activationId, metadata) {
  if (!UUID.test(activationId)) throw new Error('activation_idが不正です');
  const dir = join(stateDir, 'delegation-spent');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const path = join(dir, `${activationId}.spent`);
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify({ activation_id: activationId, ...metadata }));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const dirFd = openSync(dir, 'r');
  try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
  return path;
}

export function buildDevinArgs({ runner, model, promptFile }) {
  if (!['local', 'cloud'].includes(runner) || !MODELS.includes(model)) throw new Error('runner/modelが不正です');
  return [...(runner === 'cloud' ? ['--cloud'] : []), '--model', model, '--permission-mode', 'dangerous', '-p', '--prompt-file', promptFile];
}

function privatePrompt(path) {
  const file = realpathSync(path);
  const info = statSync(file);
  if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error('prompt fileは本人だけが読める通常ファイルにしてください');
  return file;
}

function privateLog(stateDir, issue) {
  const dir = join(stateDir, 'devin-logs');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const path = join(dir, `issue-${issue}.log`);
  const fd = openSync(path, 'a', 0o600);
  chmodSync(path, 0o600);
  return { path, fd };
}

async function spawnDevin({ args, clone, logFd }) {
  // 起動POSTの内部再送とセッション照合は導入時に確認する。出力から推測しない。
  return new Promise((resolve, reject) => {
    const child = spawn('devin', args, { cwd: clone, detached: true, stdio: ['ignore', logFd, logFd] });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve({ session_id: null, session_url: null, observed_model: 'unknown' }); });
  });
}

const resultCode = (result) => result?.code === 'pending' ? 3 : result?.code === 'content_conflict' || result?.code === 'request_conflict' ? 2 : 4;

export async function launchDelegation(options, dependencies = {}) {
  const config = dependencies.config ?? JSON.parse(readFileSync(CONFIG, 'utf8'));
  if (config.migration_complete !== true || config.cli_launch_verified !== true) return { exitCode: 4, state: 'unknown', reason: '導入確認と移行の完了待ちです' };
  if (!TASK.test(options.taskKey ?? '') || !['local', 'cloud'].includes(options.runner) || !MODELS.includes(options.model)) return { exitCode: 2, state: 'invalid' };
  let promptFile;
  let stateDir;
  try {
    promptFile = privatePrompt(options.promptFile);
    const resolved = dependencies.stateDir === undefined ? resolveStateDir({ env: process.env }) : { dir: dependencies.stateDir, trusted: true };
    if (!resolved.trusted) return { exitCode: 4, state: 'unknown', reason: '永続する状態保存先を確認できません' };
    stateDir = resolved.dir;
  } catch {
    return { exitCode: 2, state: 'invalid', reason: '非公開ファイルと状態保存先を確認してください' };
  }
  const shared = dependencies.readSnapshot && dependencies.submitRequest && dependencies.waitForResult ? dependencies : await import('./delegation-shared.mjs');
  let client;
  try { client = dependencies.client ?? (await import('./delegation-github.mjs')).createGitHubClient({ repo: config.repository, maxApiCalls: config.limits.api_calls, timeoutMs: config.limits.timeout_ms, jobTimeoutMs: config.limits.job_timeout_ms }); } catch { return { exitCode: 5, state: 'unknown', reason: '共有通信の設定を確認できません' }; }
  const uuid = dependencies.uuid ?? randomUUID;
  const callerId = options.callerId ?? uuid();
  const activationId = uuid();
  if (!UUID.test(callerId) || !UUID.test(activationId)) return { exitCode: 2, state: 'invalid' };
  let task;
  let attemptId;
  try {
    const snapshot = await shared.readSnapshot(client, config);
    task = snapshot.tasks[options.taskKey];
    if (!task || typeof task.task_digest !== 'string' || !/^[0-9a-f]{64}$/.test(task.task_digest) || !Number.isSafeInteger(task.issue) || task.issue <= 0) return { exitCode: 4, state: 'unknown', reason: '登録済みタスクの対応を確認できません' };
    const claimRequest = { schema_version: 1, operation: 'claim', request_id: uuid(), task_key: options.taskKey, caller_id: callerId, runner: options.runner, requested_model: options.model, task_digest: task.task_digest };
    const claim = await shared.submitRequest(client, config, claimRequest);
    const claimed = await shared.waitForResult(client, config, { requestId: claim.request_id, commentId: claim.request_comment_id });
    attemptId = claimed.attempt_id;
    if (!UUID.test(attemptId ?? '') || !['reserved', 'already_reserved'].includes(claimed.code)) return { exitCode: resultCode(claimed), state: 'unknown', reason: '担当の確保を確認できません' };
  } catch {
    return { exitCode: 5, state: 'unknown', reason: '共有状態と担当の対応を確認できません' };
  }
  const beginRequest = { schema_version: 1, operation: 'begin', request_id: uuid(), task_key: options.taskKey, attempt_id: attemptId, caller_id: callerId, activation_id: activationId };
  let begin;
  let receipt;
  try {
    // 送信の応答喪失時も同じ実行からbeginを再送しない。
    begin = await shared.submitRequest(client, config, beginRequest);
    receipt = await shared.waitForResult(client, config, { requestId: begin.request_id, commentId: begin.request_comment_id, activationId });
  } catch {
    return { exitCode: 4, state: 'launch_unknown', reason: 'beginの受領を確認できません。再起動せず照合してください' };
  }
  if (!consumeBeginReceipt(receipt, { requestId: beginRequest.request_id, commentId: begin.request_comment_id, attemptId, callerId, activationId })) return { exitCode: resultCode(receipt), state: 'launch_unknown', reason: '初回の起動許可を確認できません' };
  let spawned = false;
  let log;
  let observed = null;
  try {
    reserveSpent(stateDir, activationId, { request_id: beginRequest.request_id, attempt_id: attemptId, request_comment_id: begin.request_comment_id, source_run_id: receipt.source_run_id, source_run_attempt: receipt.source_run_attempt });
    log = privateLog(stateDir, task.issue);
    if (spawned) throw new Error('起動済みです');
    spawned = true;
    observed = await (dependencies.spawnOnce ?? spawnDevin)({ args: buildDevinArgs({ runner: options.runner, model: options.model, promptFile }), runner: options.runner, model: options.model, promptFile, clone: options.clone ?? (options.runner === 'local' ? DEFAULT_CLONE : process.cwd()), logFd: log.fd });
  } catch {
    observed = null;
  } finally {
    if (log !== undefined) closeSync(log.fd);
  }
  const sessionId = typeof observed?.session_id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(observed.session_id) ? observed.session_id : null;
  const sessionUrl = typeof observed?.session_url === 'string' && /^https:\/\/app\.devin\.ai\/sessions\/[A-Za-z0-9_-]{1,128}\/?$/.test(observed.session_url) ? observed.session_url : null;
  const sessionConfirmed = sessionId !== null && sessionUrl !== null && sessionUrl.replace(/\/$/, '').endsWith(`/sessions/${sessionId}`);
  const observedModel = options.runner === 'cloud' ? 'unknown' : MODELS.includes(observed?.observed_model) ? observed.observed_model : 'unknown';
  try {
    const request = { schema_version: 1, operation: 'started', request_id: uuid(), task_key: options.taskKey, attempt_id: attemptId, caller_id: callerId, activation_id: activationId, session_id: sessionConfirmed ? sessionId : null, session_url: sessionConfirmed ? sessionUrl : null, observed_model: observedModel };
    const sent = await shared.submitRequest(client, config, request);
    const started = await shared.waitForResult(client, config, { requestId: sent.request_id, commentId: sent.request_comment_id, activationId });
    if (sessionConfirmed && started.code === 'running') return { exitCode: 0, state: 'running', attempt_id: attemptId, activation_id: activationId, runner: options.runner, requested_model: options.model, observed_model: observedModel, session_id: sessionId, session_url: sessionUrl };
  } catch {
    // spawn後は通信の復旧でも起動し直さない。
  }
  return { exitCode: 4, state: 'launch_unknown', attempt_id: attemptId, activation_id: activationId, reason: '起動結果を照合してください。自動再起動はしません' };
}

export async function runLaunchCli(argv, dependencies = {}) {
  let options;
  try { options = parseLaunchArgs(argv); } catch { return { exitCode: 2, state: 'invalid', reason: '起動引数を確認してください' }; }
  return launchDelegation(options, dependencies);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await runLaunchCli(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.exitCode;
  } catch {
    console.error('起動結果を確認できません。再起動せず共有状態を照合してください');
    process.exitCode = 5;
  }
}
