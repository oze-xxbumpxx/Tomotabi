#!/usr/bin/env node
// 委譲（Issue → Devin → PR）ごとの記録を作り、集計する。
// 設計: docs/designs/devin-delegation-loop.md / 形式: docs/claude-code/improvements/delegations/README.md
//
// 使い方:
//   node .claude/scripts/delegation.mjs init <issue> --model <swe-2-medium|swe-2-high|swe-2-max|unknown>
//     [--runner <local|cloud>] [--level 0-3] [--title <題>] [--delegated-at <ISO 8601>]
//       --runner は Devin を動かした場所。既定は local（2026-09-26 ユーザー指示: 既定はローカル、出先の指示時だけクラウド）。
//       記録を作る。--title と --delegated-at を省くと gh から Issue の題と作成日時を取る。
//   node .claude/scripts/delegation.mjs review <issue> --round <n> --sha <sha> --verdict <merge|fix|escalate>
//     [--posted] [--finding '<must|nit|security|decision>:<category>:<summary>' ...]
//       round の結果を追記する。
//   node .claude/scripts/delegation.mjs finalize <issue> [--pr <PR番号>]
//       gh から PR・時刻・CI 初回（PR 作成時の head）・コミット数・Closes の紐づけを取り、gh: と outcome を埋める。
//   node .claude/scripts/delegation.mjs summary [--threshold 3] [--security-threshold 2]
//       記録だけを読んで集計する（gh は呼ばない）。
//   すべてのサブコマンドで --dir <path> を指定すると記録の置き場を変えられる（テスト用）。
//
// 終了コード: 0 成功 / 2 引数・記録の誤り / 3 gh の失敗・PR が見つからない
//
// 方針:
// - 記録は公開リポジトリに入る。security の指摘は summary を「(非公開)」に置き換える。
// - YAML は依存を増やさないため、この記録の形（スカラー・ネストした map・map の配列）だけを
//   読み書きする最小の実装にする。その他の形はエラーにする。
// - 書き込みは一時ファイル → rename。init は既存を上書きしない。

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findLinkedPr, listPrs } from './wait-for-pr.mjs';

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../docs/claude-code/improvements/delegations');
const GH_TIMEOUT_MS = 30_000;

export const MODELS = ['swe-2-medium', 'swe-2-high', 'swe-2-max', 'unknown'];
// 新しい記録で指定できる実行場所。runner の無い古い記録は、集計のときだけ unknown として扱う。
export const RUNNERS = ['local', 'cloud'];
export const SEVERITIES = ['must', 'nit', 'security', 'decision'];
export const VERDICTS = ['merge', 'fix', 'escalate'];
export const PRIVATE_SUMMARY = '(非公開)';
const CATEGORY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export class UsageError extends Error {}

// ---------------------------------------------------------------- YAML（この記録の形だけ）

function emitScalar(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new UsageError(`YAML に書けない数値: ${value}`);
    return String(value);
  }
  if (typeof value === 'string') {
    if (/[\r\n]/.test(value)) throw new UsageError('YAML の文字列に改行は使えません');
    return `'${value.replaceAll("'", "''")}'`;
  }
  throw new UsageError(`YAML に書けない値: ${typeof value}`);
}

const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function emitMap(obj, indent) {
  const pad = ' '.repeat(indent);
  const lines = [];
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      if (value.length === 0) lines.push(`${pad}${key}: []`);
      else lines.push(`${pad}${key}:`, ...emitList(value, indent + 2));
    } else if (isMap(value)) {
      if (Object.keys(value).length === 0) lines.push(`${pad}${key}: {}`);
      else lines.push(`${pad}${key}:`, ...emitMap(value, indent + 2));
    } else {
      lines.push(`${pad}${key}: ${emitScalar(value)}`);
    }
  }
  return lines;
}

function emitList(items, indent) {
  return items.flatMap((item) => {
    if (!isMap(item) || Object.keys(item).length === 0) throw new UsageError('YAML の配列の要素は空でない map に限ります');
    const lines = emitMap(item, indent + 2);
    lines[0] = `${' '.repeat(indent)}- ${lines[0].slice(indent + 2)}`;
    return lines;
  });
}

export function toYaml(obj) {
  return `${emitMap(obj, 0).join('\n')}\n`;
}

function parseScalar(text, fail) {
  if (text.startsWith("'")) {
    const inner = text.slice(1, -1);
    if (text.length < 2 || !text.endsWith("'") || inner.replaceAll("''", '').includes("'")) fail('引用符が閉じていません');
    return inner.replaceAll("''", "'");
  }
  if (text === 'null' || text === '~') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === '[]') return [];
  if (text === '{}') return {};
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (/^["{[&*|>!%@`]/.test(text) || / #/.test(text)) fail(`この形の値は読めません: ${text}`);
  return text;
}

export function parseYaml(text) {
  const lines = [];
  text.split('\n').forEach((raw, index) => {
    if (/^\s*(?:#.*)?$/.test(raw)) return;
    const lead = raw.match(/^\s*/)[0];
    if (lead.includes('\t')) throw new UsageError(`YAML ${index + 1} 行目: インデントにタブは使えません`);
    lines.push({ indent: lead.length, text: raw.slice(lead.length).trimEnd(), no: index + 1 });
  });
  let i = 0;
  const failAt = (line) => (message) => {
    throw new UsageError(`YAML ${line.no} 行目: ${message}`);
  };
  const isItem = (line) => line.text === '-' || line.text.startsWith('- ');

  function parseMap(indent) {
    const obj = {};
    while (i < lines.length && lines[i].indent === indent && !isItem(lines[i])) {
      const line = lines[i];
      const fail = failAt(line);
      const m = line.text.match(/^([A-Za-z_][\w-]*):(?: +(.*))?$/);
      if (m === null) fail(`key: value の形ではありません: ${line.text}`);
      const [, key, value] = m;
      if (Object.hasOwn(obj, key)) fail(`キーが重複しています: ${key}`);
      i += 1;
      if (value !== undefined && value !== '') obj[key] = parseScalar(value, fail);
      else if (i < lines.length && lines[i].indent > indent) obj[key] = isItem(lines[i]) ? parseList(lines[i].indent) : parseMap(lines[i].indent);
      else if (i < lines.length && lines[i].indent === indent && isItem(lines[i])) obj[key] = parseList(indent);
      else obj[key] = null;
    }
    if (i < lines.length && lines[i].indent > indent) failAt(lines[i])('インデントが不正です');
    return obj;
  }

  function parseList(indent) {
    const items = [];
    while (i < lines.length && lines[i].indent === indent && isItem(lines[i])) {
      const line = lines[i];
      const rest = line.text.slice(1);
      const gap = rest.match(/^ */)[0].length;
      if (rest.trim() === '' || gap === 0) failAt(line)('配列の要素は「- key: value」の形にしてください');
      const itemIndent = indent + 1 + gap;
      lines[i] = { indent: itemIndent, text: rest.slice(gap), no: line.no };
      items.push(parseMap(itemIndent));
    }
    return items;
  }

  if (lines.length === 0) return {};
  if (lines[0].indent !== 0) failAt(lines[0])('最初の行はインデントなしにしてください');
  const result = parseMap(0);
  if (i < lines.length) failAt(lines[i])('読めない行です');
  return result;
}

// ---------------------------------------------------------------- 記録の操作（純粋関数）

export function newRecord({ issue, title, model, runner = 'local', level = null, delegatedAt }) {
  if (!Number.isInteger(issue) || issue <= 0) throw new UsageError('Issue 番号が不正です');
  if (!MODELS.includes(model)) throw new UsageError(`--model は ${MODELS.join(' | ')} のどれか`);
  if (!RUNNERS.includes(runner)) throw new UsageError(`--runner は ${RUNNERS.join(' | ')} のどれか`);
  if (level !== null && ![0, 1, 2, 3].includes(level)) throw new UsageError('--level は 0〜3');
  if (Number.isNaN(Date.parse(delegatedAt))) throw new UsageError('委譲の日時が ISO 8601 ではありません');
  return {
    issue,
    title,
    agent: 'devin',
    model,
    runner,
    change_level: level,
    delegated_at: delegatedAt,
    reviews: [],
    escalations: 0,
    outcome: null,
    gh: null,
  };
}

/** '<severity>:<category>:<summary>'。summary には ':' を含めてよい。security の summary は公開しない。 */
export function parseFinding(text) {
  const first = text.indexOf(':');
  const second = first === -1 ? -1 : text.indexOf(':', first + 1);
  if (second === -1) throw new UsageError(`--finding は '<severity>:<category>:<summary>' の形: ${text}`);
  const severity = text.slice(0, first).trim();
  const category = text.slice(first + 1, second).trim();
  const summary = text.slice(second + 1).trim();
  if (!SEVERITIES.includes(severity)) throw new UsageError(`severity は ${SEVERITIES.join(' | ')} のどれか: ${severity}`);
  if (!CATEGORY.test(category)) throw new UsageError(`category は kebab-case: ${category}`);
  if (summary === '') throw new UsageError('summary が空です');
  return { severity, category, summary: severity === 'security' ? PRIVATE_SUMMARY : summary.replace(/\s+/g, ' ') };
}

export function addReview(record, { round, sha, verdict, posted = false, findings = [] }) {
  if (!Number.isInteger(round) || round < 0) throw new UsageError('--round は 0 以上の整数');
  if (!VERDICTS.includes(verdict)) throw new UsageError(`--verdict は ${VERDICTS.join(' | ')} のどれか`);
  if (typeof sha !== 'string' || !/^[0-9a-f]{7,40}$/.test(sha)) throw new UsageError('--sha はコミットの SHA');
  if (record.reviews.some((r) => r.round === round)) throw new UsageError(`round ${round} は記録済みです`);
  if (posted && findings.some((f) => f.severity === 'security' || f.severity === 'decision')) {
    throw new UsageError('security / decision の指摘は自動投稿しません（--posted と併用できない）');
  }
  const review = { round, reviewed_sha: sha, verdict, posted, findings };
  return {
    ...record,
    reviews: [...record.reviews, review].sort((a, b) => a.round - b.round),
    escalations: record.escalations + (verdict === 'escalate' ? 1 : 0),
  };
}

const PASSING = new Set(['success', 'skipped', 'neutral']);

/**
 * CI の「初回」とみなすコミット = PR を作った時点の head（作成時刻以前で最後のコミット）。
 * 複数のコミットをまとめて push すると CI は最後のコミットでしか動かないため、最初のコミットではない（#39・#42）。
 */
export function firstCiCommit(commits, prCreatedAt) {
  const created = Date.parse(prCreatedAt);
  const before = commits.filter((c) => Date.parse(c.committedDate) <= created);
  return (before.at(-1) ?? commits[0])?.oid ?? null;
}

/**
 * @param {object} pr gh pr view --json number,state,createdAt,mergedAt,closedAt,commits,closingIssuesReferences
 * @param {Array<{status:string,conclusion:string|null}> | null} firstCommitRuns firstCiCommit の check-runs
 */
export function buildGhSection(pr, issue, firstCommitRuns) {
  let ciFirstPass = null;
  if (firstCommitRuns !== null && firstCommitRuns.length > 0) {
    ciFirstPass = firstCommitRuns.every((r) => r.status === 'completed' && PASSING.has(r.conclusion));
  }
  return {
    outcome: { MERGED: 'merged', CLOSED: 'closed', OPEN: 'open' }[pr.state] ?? null,
    gh: {
      pr: pr.number,
      pr_created_at: pr.createdAt,
      merged_at: pr.mergedAt || null,
      closed_at: pr.closedAt || null,
      commits: (pr.commits ?? []).length,
      ci_first_pass: ciFirstPass,
      closes_linked: (pr.closingIssuesReferences ?? []).some((ref) => ref.number === issue),
    },
  };
}

// ---------------------------------------------------------------- 集計

const minutesBetween = (from, to) => (from && to ? (Date.parse(to) - Date.parse(from)) / 60000 : null);

function median(values) {
  const sorted = values.filter((v) => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 投稿した回数 = 手戻りの回数。 */
export const roundsOf = (record) => record.reviews.filter((r) => r.posted).length;

function groupStats(records, keyOf) {
  const groups = {};
  for (const rec of records) {
    const m = (groups[keyOf(rec)] ??= {
      count: 0,
      merged: 0,
      finished: 0,
      reviewed: 0,
      firstPass: 0,
      rounds: [],
      ciKnown: 0,
      ciPass: 0,
      issueToPr: [],
      prToMerge: [],
      escalations: 0,
    });
    m.count += 1;
    if (rec.outcome === 'merged' || rec.outcome === 'closed') m.finished += 1;
    if (rec.outcome === 'merged') m.merged += 1;
    if (rec.reviews.length > 0) {
      m.reviewed += 1;
      m.rounds.push(roundsOf(rec));
      if (rec.reviews[0].verdict === 'merge') m.firstPass += 1;
    }
    m.escalations += rec.escalations ?? 0;
    if (typeof rec.gh?.ci_first_pass === 'boolean') {
      m.ciKnown += 1;
      if (rec.gh.ci_first_pass) m.ciPass += 1;
    }
    m.issueToPr.push(minutesBetween(rec.delegated_at, rec.gh?.pr_created_at));
    m.prToMerge.push(minutesBetween(rec.gh?.pr_created_at, rec.gh?.merged_at));
  }
  return Object.fromEntries(
    Object.entries(groups).map(([key, m]) => [
      key,
      {
        count: m.count,
        merged: m.merged,
        finished: m.finished,
        reviewed: m.reviewed,
        firstPass: m.firstPass,
        avgRounds: m.rounds.length === 0 ? null : m.rounds.reduce((a, b) => a + b, 0) / m.rounds.length,
        ciKnown: m.ciKnown,
        ciPass: m.ciPass,
        escalations: m.escalations,
        medianIssueToPrMin: median(m.issueToPr),
        medianPrToMergeMin: median(m.prToMerge),
      },
    ]),
  );
}

export function summarize(records, { threshold = 3, securityThreshold = 2 } = {}) {
  const categories = new Map();
  for (const rec of records) {
    for (const review of rec.reviews) {
      for (const f of review.findings ?? []) {
        if (!categories.has(f.category)) categories.set(f.category, new Set());
        categories.get(f.category).add(rec.issue);
      }
    }
  }
  const byCategory = [...categories]
    .map(([category, issues]) => {
      const limit = category === 'security' ? securityThreshold : threshold;
      return { category, issues: [...issues].sort((a, b) => a - b), threshold: limit, candidate: issues.size >= limit };
    })
    .sort((a, b) => b.issues.length - a.issues.length || a.category.localeCompare(b.category));
  return {
    total: records.length,
    outcomes: {
      merged: records.filter((r) => r.outcome === 'merged').length,
      closed: records.filter((r) => r.outcome === 'closed').length,
      open: records.filter((r) => r.outcome !== 'merged' && r.outcome !== 'closed').length,
    },
    models: groupStats(records, (rec) => rec.model),
    runners: groupStats(records, (rec) => rec.runner ?? 'unknown'),
    byCategory,
    candidates: byCategory.filter((c) => c.candidate).map((c) => c.category),
  };
}

function formatDuration(min) {
  if (min === null) return '-';
  if (min < 90) return `${Math.round(min)}m`;
  if (min < 48 * 60) return `${(min / 60).toFixed(1)}h`;
  return `${(min / 1440).toFixed(1)}d`;
}

const ratio = (a, b) => (b === 0 ? '-' : `${a}/${b}`);

function formatGroupRows(groups) {
  return Object.entries(groups)
    .sort()
    .map(
      ([key, m]) =>
        `  ${key}: ${m.count} / ${ratio(m.merged, m.finished)} / ${ratio(m.firstPass, m.reviewed)} / ` +
        `${m.avgRounds === null ? '-' : m.avgRounds.toFixed(1)} / ${ratio(m.ciPass, m.ciKnown)} / ${m.escalations} / ` +
        `${formatDuration(m.medianIssueToPrMin)} / ${formatDuration(m.medianPrToMergeMin)}`,
    );
}

export function formatSummary(s) {
  const out = [`委譲 ${s.total} 件（merged ${s.outcomes.merged} / closed ${s.outcomes.closed} / open ${s.outcomes.open}）`];
  if (s.total === 0) return out.join('\n');
  const columns = '件数 / マージ / 一発合格 / 平均round / CI初回成功 / 引き渡し / Issue→PR中央値 / PR→マージ中央値';
  out.push('', `モデル別: ${columns}`, ...formatGroupRows(s.models));
  out.push('', `実行場所別: ${columns}`, ...formatGroupRows(s.runners));
  out.push('', '分類別（指摘が出た Issue の数 / 昇格の閾値）');
  for (const c of s.byCategory) {
    const note = c.candidate ? '  ← 昇格候補' : `  あと ${c.threshold - c.issues.length} 件`;
    out.push(`  ${c.category}: ${c.issues.length}/${c.threshold}（${c.issues.map((n) => `#${n}`).join(' ')}）${note}`);
  }
  out.push('', `昇格候補: ${s.candidates.length === 0 ? 'なし' : s.candidates.join(', ')}`);
  return out.join('\n');
}

// ---------------------------------------------------------------- ファイルと gh

const recordPath = (dir, issue) => join(dir, `${issue}.yml`);

export function readRecord(dir, issue) {
  const path = recordPath(dir, issue);
  if (!existsSync(path)) throw new UsageError(`記録がありません: ${path}（先に init）`);
  return parseYaml(readFileSync(path, 'utf8'));
}

export function writeRecord(dir, record) {
  mkdirSync(dir, { recursive: true });
  const path = recordPath(dir, record.issue);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, toYaml(record));
  renameSync(tmp, path);
  return path;
}

export function readAllRecords(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^\d+\.yml$/.test(name))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .map((name) => parseYaml(readFileSync(join(dir, name), 'utf8')));
}

class GhError extends Error {}

function gh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS });
  } catch (error) {
    throw new GhError(`gh ${args.slice(0, 2).join(' ')} に失敗しました: ${error.message.split('\n')[0]}`);
  }
}

function findPrNumber(record) {
  if (record.gh?.pr) return record.gh.pr;
  const pr = findLinkedPr(listPrs(record.delegated_at), record.issue, record.delegated_at);
  if (pr === null) throw new GhError(`Issue #${record.issue} に紐づく PR が見つかりません（--pr で指定できます）`);
  return pr.number;
}

function fetchFinalize(record, prNumber) {
  const pr = JSON.parse(
    gh(['pr', 'view', String(prNumber), '--json', 'number,state,createdAt,mergedAt,closedAt,commits,closingIssuesReferences']),
  );
  const first = firstCiCommit(pr.commits ?? [], pr.createdAt);
  let runs = null;
  if (first) {
    const res = JSON.parse(gh(['api', `repos/{owner}/{repo}/commits/${first}/check-runs`, '--jq', '{check_runs: [.check_runs[] | {status, conclusion}]}']));
    runs = res.check_runs;
  }
  return buildGhSection(pr, record.issue, runs);
}

// ---------------------------------------------------------------- CLI

export function parseOptions(argv, spec) {
  const opts = {};
  const repeated = new Set(spec.repeated ?? []);
  const flags = new Set(spec.flags ?? []);
  const values = new Set([...(spec.values ?? []), ...repeated, 'dir']);
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].startsWith('--') ? argv[i].slice(2) : null;
    if (key !== null && flags.has(key)) {
      opts[key] = true;
    } else if (key !== null && values.has(key)) {
      const value = argv[i + 1];
      if (value === undefined) throw new UsageError(`--${key} に値がありません`);
      i += 1;
      if (repeated.has(key)) (opts[key] ??= []).push(value);
      else opts[key] = value;
    } else {
      throw new UsageError(`不明な引数: ${argv[i]}`);
    }
  }
  return opts;
}

function toInt(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new UsageError(`${name} は 0 以上の整数`);
  return n;
}

function issueArg(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new UsageError('Issue 番号が不正です');
  return n;
}

export function runCli(argv) {
  const [command, ...rest] = argv;
  if (command === 'summary') {
    const opts = parseOptions(rest, { values: ['threshold', 'security-threshold'] });
    const summary = summarize(readAllRecords(opts.dir ?? DEFAULT_DIR), {
      threshold: opts.threshold === undefined ? 3 : toInt(opts.threshold, '--threshold'),
      securityThreshold: opts['security-threshold'] === undefined ? 2 : toInt(opts['security-threshold'], '--security-threshold'),
    });
    console.log(formatSummary(summary));
    return;
  }
  const [issueText, ...optArgs] = rest;
  if (command === 'init') {
    const issue = issueArg(issueText);
    const opts = parseOptions(optArgs, { values: ['model', 'runner', 'level', 'title', 'delegated-at'] });
    const dir = opts.dir ?? DEFAULT_DIR;
    if (opts.model === undefined) throw new UsageError('--model が必要です');
    if (!MODELS.includes(opts.model)) throw new UsageError(`--model は ${MODELS.join(' | ')} のどれか`);
    if (existsSync(recordPath(dir, issue))) throw new UsageError(`記録は作成済みです: ${recordPath(dir, issue)}`);
    let { title, 'delegated-at': delegatedAt } = opts;
    if (title === undefined || delegatedAt === undefined) {
      const info = JSON.parse(gh(['issue', 'view', String(issue), '--json', 'title,createdAt']));
      title ??= info.title;
      delegatedAt ??= info.createdAt;
    }
    const level = opts.level === undefined ? null : toInt(opts.level, '--level');
    console.log(writeRecord(dir, newRecord({ issue, title, model: opts.model, runner: opts.runner ?? 'local', level, delegatedAt })));
    return;
  }
  if (command === 'review') {
    const issue = issueArg(issueText);
    const opts = parseOptions(optArgs, { values: ['round', 'sha', 'verdict'], flags: ['posted'], repeated: ['finding'] });
    const dir = opts.dir ?? DEFAULT_DIR;
    if (opts.round === undefined) throw new UsageError('--round が必要です');
    const record = addReview(readRecord(dir, issue), {
      round: toInt(opts.round, '--round'),
      sha: opts.sha,
      verdict: opts.verdict,
      posted: opts.posted === true,
      findings: (opts.finding ?? []).map(parseFinding),
    });
    console.log(writeRecord(dir, record));
    return;
  }
  if (command === 'finalize') {
    const issue = issueArg(issueText);
    const opts = parseOptions(optArgs, { values: ['pr'] });
    const dir = opts.dir ?? DEFAULT_DIR;
    const record = readRecord(dir, issue);
    const prNumber = opts.pr === undefined ? findPrNumber(record) : issueArg(opts.pr);
    console.log(writeRecord(dir, { ...record, ...fetchFinalize(record, prNumber) }));
    return;
  }
  throw new UsageError('usage: delegation.mjs <init|review|finalize|summary> …（詳細はファイル先頭のコメント）');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(error instanceof UsageError ? 2 : error instanceof GhError ? 3 : 1);
  }
}
