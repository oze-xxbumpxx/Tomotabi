#!/usr/bin/env node
// 検討ダッシュボードのデータ（JSON）を検査し、ひな形に埋めてHTMLにする。
// スキル: .claude/skills/visualize-decision/SKILL.md
//
// 使い方（リポジトリのルートで）:
//   node .claude/scripts/decision-dashboard.mjs check <JSONのpath>
//   node .claude/scripts/decision-dashboard.mjs build <JSONのpath> --out <HTMLのpath>
//
// 終了コード: 0 / 1（データの形の誤り） / 2（引数の誤り）
//
// 方針: 形の確認とHTMLの組み立ては純粋関数にし、テストで固定する。
// 文章はページ側でtextContentで描く。図（svg）と選択肢の見本（mock）だけはHTMLのまま埋めるので、
// scriptとon*属性とjavascript:はここで弾く。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const TEMPLATE_PATH = join(here, '../skills/visualize-decision/template.html');

export const STATES = ['waiting', 'tentative', 'later', 'decided'];
export const TYPES = ['question', 'task'];
export const MAX_WAITING = 10;

export class UsageError extends Error {}
export class FormError extends Error {}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UNSAFE_RE = /<\s*script|<\s*iframe|<\s*object|<\s*embed|\son[a-z]+\s*=|javascript:/i;

function isText(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function checkRich(code, where, errors) {
  if (typeof code !== 'string') {
    errors.push(`${where}: 文字列で書く`);
    return;
  }
  if (UNSAFE_RE.test(code)) errors.push(`${where}: script・iframe・on*属性・javascript:は使えない`);
}

function checkOptions(item, where, errors) {
  const options = item.options;
  if (!Array.isArray(options) || options.length < 2) {
    errors.push(`${where}: 選択肢（options）は2つ以上`);
    return;
  }
  const keys = new Set();
  for (const [i, o] of options.entries()) {
    const w = `${where} 選択肢${i + 1}`;
    if (!o || typeof o.key !== 'string' || !/^[A-Z]$/.test(o.key)) errors.push(`${w}: keyは大文字1字（A, B, ...）`);
    else if (keys.has(o.key)) errors.push(`${w}: key ${o.key}が重なっている`);
    else keys.add(o.key);
    if (!isText(o?.title)) errors.push(`${w}: titleが無い`);
    if (!isText(o?.pros)) errors.push(`${w}: 利点（pros）が無い`);
    if (!isText(o?.cons)) errors.push(`${w}: 欠点（cons）が無い`);
    if (o?.mock != null) checkRich(o.mock, `${w} mock`, errors);
  }
  const open = item.state === 'waiting' || item.state === 'tentative';
  if (open) {
    if (!keys.has(item.recommend)) errors.push(`${where}: 推奨（recommend）は選択肢のkeyのどれか`);
    if (!isText(item.reason)) errors.push(`${where}: 推奨の理由（reason）が無い`);
  }
}

/** データの形を確かめ、誤りの一覧を返す（空なら正しい）。 */
export function validateState(state) {
  const errors = [];
  if (!state || typeof state !== 'object' || Array.isArray(state)) return ['データはオブジェクトで書く'];
  if (!isText(state.title)) errors.push('title（見出し）が無い');
  if (state.round != null && !(Number.isInteger(state.round) && state.round >= 1)) errors.push('roundは1以上の整数');
  if (!Array.isArray(state.items) || state.items.length === 0) {
    errors.push('items（問いと作業）が1つも無い');
    return errors;
  }
  const ids = new Set();
  let waiting = 0;
  for (const [i, it] of state.items.entries()) {
    const where = `items[${i}]${it?.id ? `(${it.id})` : ''}`;
    if (!it || typeof it !== 'object') {
      errors.push(`${where}: オブジェクトで書く`);
      continue;
    }
    if (typeof it.id !== 'string' || !ID_RE.test(it.id)) errors.push(`${where}: idは英小文字・数字・ハイフン`);
    else if (ids.has(it.id)) errors.push(`${where}: idが重なっている`);
    else ids.add(it.id);
    if (!TYPES.includes(it.type)) errors.push(`${where}: typeはquestionかtask`);
    if (!STATES.includes(it.state)) errors.push(`${where}: stateは${STATES.join(' / ')}`);
    if (!isText(it.label)) errors.push(`${where}: label（問い・作業の1文）が無い`);
    if (it.state === 'waiting') waiting += 1;
    if (it.facts != null && !(Array.isArray(it.facts) && it.facts.every(isText))) errors.push(`${where}: factsは文字列の配列`);
    if (it.evidence != null && !(Array.isArray(it.evidence) && it.evidence.every(isText))) errors.push(`${where}: evidenceは文字列の配列`);

    for (const [j, p] of (it.panels ?? []).entries()) {
      const w = `${where} 図${j + 1}`;
      if (!isText(p?.title)) errors.push(`${w}: titleが無い`);
      if (!isText(p?.body) && !isText(p?.figure)) errors.push(`${w}: bodyかfigureのどちらかは要る`);
      if (p?.figure != null) checkRich(p.figure, `${w} figure`, errors);
    }

    if (it.type === 'task') {
      if (!isText(it.body) && !(Array.isArray(it.steps) && it.steps.length)) errors.push(`${where}: 作業にはbodyかstepsが要る`);
    } else if (it.type === 'question') {
      if (it.state === 'decided') {
        if (!isText(it.decision?.choice)) errors.push(`${where}: 決定済みにはdecision.choiceが要る`);
        if (it.options != null) checkOptions(it, where, errors);
      } else {
        checkOptions(it, where, errors);
        if (it.state === 'waiting' && !isText(it.kind)) errors.push(`${where}: 回答待ちにはkind（画面 / アプリの決まり / API / 設計 / 実装 / 改善）が要る`);
      }
    }
  }
  if (waiting > MAX_WAITING) errors.push(`回答待ちが${waiting}件ある。${MAX_WAITING}件以内に絞り、残りはtentativeかlaterにする`);
  return errors;
}

/** JSONを<script>に埋めるとき、</script>で閉じられないよう`<`を逃がす。 */
export function embedJson(state) {
  return JSON.stringify(state)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** ひな形にタイトルとデータを埋めてHTMLにする。 */
export function renderPage(state, template) {
  const errors = validateState(state);
  if (errors.length) throw new FormError(errors.join('\n'));
  return template.replace('__TITLE__', () => escapeHtml(state.title)).replace('__STATE__', () => embedJson({ ...state, round: state.round ?? 1 }));
}

function readState(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new UsageError(`読めない: ${path}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new UsageError(`JSONとして読めない: ${e.message}`);
  }
}

export function main(argv, io = { log: console.log, err: console.error }) {
  const [cmd, file, ...rest] = argv;
  try {
    if (!['check', 'build'].includes(cmd) || !file) throw new UsageError('使い方: decision-dashboard.mjs check|build <JSONのpath> [--out <HTMLのpath>]');
    const state = readState(file);
    if (cmd === 'check') {
      const errors = validateState(state);
      if (errors.length) {
        errors.forEach((e) => io.err(`NG ${e}`));
        return 1;
      }
      io.log(`OK ${state.items.length}件`);
      return 0;
    }
    const at = rest.indexOf('--out');
    if (at === -1 || !rest[at + 1]) throw new UsageError('buildには--out <HTMLのpath>が要る');
    const out = resolve(rest[at + 1]);
    const html = renderPage(state, readFileSync(TEMPLATE_PATH, 'utf8'));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, html);
    io.log(`書き出した: ${out}`);
    return 0;
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(e.message);
      return 2;
    }
    if (e instanceof FormError) {
      io.err(e.message);
      return 1;
    }
    throw e;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
