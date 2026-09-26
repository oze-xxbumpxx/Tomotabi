// wait-for-pr.mjs の「Issue に紐づく PR」の判定と引数検査のテスト。gh は呼ばない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findLinkedPr } from '../scripts/wait-for-pr.mjs';

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), '../scripts/wait-for-pr.mjs');

test('本文の Closes / Fixes / Resolves #N で見つける', () => {
  for (const body of ['Closes #37', 'fixes #37', 'Resolved #37 です']) {
    const pr = findLinkedPr([{ number: 40, body, headRefName: 'x' }], 37);
    assert.equal(pr?.number, 40, body);
  }
});

test('本文の「Issue #N」とブランチ名の末尾 -N でも見つける（Closes の書き忘れ対策）', () => {
  assert.equal(findLinkedPr([{ number: 33, body: 'Issue #32（M1-b3）。', headRefName: 'devin/m1b3' }], 32)?.number, 33);
  assert.equal(findLinkedPr([{ number: 34, body: '', headRefName: 'devin/m1b1-guard-foundation-30' }], 30)?.number, 34);
});

test('番号の前方一致や無関係な参照では見つけない', () => {
  const prs = [
    { number: 50, body: 'Closes #370', headRefName: 'devin/foo-370' },
    { number: 51, body: 'PR #37 を参照', headRefName: 'devin/bar' },
    { number: 52, body: 'See #37', headRefName: 'fix/37-typo' },
  ];
  assert.equal(findLinkedPr(prs, 37), null);
});

test('複数あれば番号が最小の PR を返す', () => {
  const prs = [
    { number: 45, body: 'Closes #37', headRefName: 'b' },
    { number: 41, body: 'Issue #37 の続き', headRefName: 'a' },
  ];
  assert.equal(findLinkedPr(prs, 37)?.number, 41);
});

test('引数が不正なら終了コード 2 で gh を呼ばない', () => {
  for (const args of [[], ['abc'], ['0'], ['37', '--interval', '-1'], ['37', '--unknown', '5']]) {
    let code = 0;
    try {
      execFileSync(process.execPath, [scriptPath, ...args], { stdio: 'pipe' });
    } catch (error) {
      code = error.status;
    }
    assert.equal(code, 2, JSON.stringify(args));
  }
});
