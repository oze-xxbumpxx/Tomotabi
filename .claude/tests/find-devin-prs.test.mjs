// find-devin-prs.mjs（SessionStart Hook）のテスト。gh は呼ばない。
// 観点 ID は docs/tests/devin-unlinked-pr-review.md。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContext } from '../hooks/find-devin-prs.mjs';

const hookPath = join(dirname(fileURLToPath(import.meta.url)), '../hooks/find-devin-prs.mjs');

test('F-01: コメントを取得できなかった PR も捨てずに「未確認」として出す', () => {
  const text = buildContext([{ number: 91, headRefName: 'devin/b', title: 'b' }], [{ number: 90, headRefName: 'devin/a', title: 'a' }]);
  assert.match(text, /PR #91（devin\/b）b\n/);
  assert.match(text, /PR #90（devin\/a）a ※コメントを取得できず、レビュー済みかは未確認/);
});

test('F-02: 促す文に PR 番号・ブランチと review-devin-pr・記録の作り方がある', () => {
  const text = buildContext([
    { number: 53, headRefName: 'devin/update-skills-1790414398', title: 'docs(skills): testing-web-ui' },
    { number: 54, headRefName: 'devin/update-blueprint-1790414400', title: 'blueprint' },
  ]);
  assert.match(text, /PR #53（devin\/update-skills-1790414398）/);
  assert.match(text, /PR #54/);
  assert.match(text, /review-devin-pr/);
  assert.match(text, /delegation\.mjs init pr-/);
  // 中断したレビューの記録は init し直さない
  assert.match(text, /中断したレビュー/);
});

test('F-03: gh が無い環境では何も出さず exit 0', () => {
  const emptyBin = mkdtempSync(join(tmpdir(), 'no-gh-'));
  try {
    const res = spawnSync(process.execPath, [hookPath], { encoding: 'utf8', env: { ...process.env, PATH: emptyBin } });
    assert.equal(res.status, 0);
    assert.equal(res.stdout, '');
  } finally {
    rmSync(emptyBin, { recursive: true, force: true });
  }
});
