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

test('GitHub が認識した紐づけ（closingIssuesReferences）とブランチ名の末尾 -N で見つける', () => {
  assert.equal(findLinkedPr([{ number: 39, body: '', headRefName: 'devin/m1-b4', closingIssuesReferences: [{ number: 37 }] }], 37)?.number, 39);
  // #33 は本文に Closes が無かったが、ブランチ名の末尾で紐づく
  assert.equal(findLinkedPr([{ number: 33, body: 'Issue #32（M1-b3）。', headRefName: 'devin/m1b3-me-contract-32' }], 32)?.number, 33);
});

test('本文で「Issue #N」と言及しただけの別 PR は紐づけとみなさない', () => {
  const prs = [{ number: 28, body: 'Issue #24 / #26 の作成と PR #25 のレビュー', headRefName: 'docs/log-devin-automation' }];
  assert.equal(findLinkedPr(prs, 24), null);
});

test('Issue の作成より前に作られた PR は対象外', () => {
  const since = '2026-09-25T22:57:13Z';
  const prs = [
    { number: 20, body: 'Closes #37', headRefName: 'a', createdAt: '2026-09-20T00:00:00Z' },
    { number: 39, body: 'Closes #37', headRefName: 'b', createdAt: '2026-09-26T00:20:27Z' },
  ];
  assert.equal(findLinkedPr(prs, 37, since)?.number, 39);
  assert.equal(findLinkedPr(prs.slice(0, 1), 37, since), null);
  // 作成日時が取れない PR も、since 指定時は対象外（安全側）
  assert.equal(findLinkedPr([{ number: 41, body: 'Closes #37', headRefName: 'c' }], 37, since), null);
});

test('複数あれば番号が最小の PR を返す', () => {
  const prs = [
    { number: 45, body: 'Closes #37', headRefName: 'b' },
    { number: 41, body: 'Fixes #37', headRefName: 'a' },
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
