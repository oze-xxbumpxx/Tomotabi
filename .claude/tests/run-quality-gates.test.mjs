// run-quality-gates.sh — package.json 無しでもハーネス試験に落ち、休眠テストは既定除外。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), '../scripts/run-quality-gates.sh');

function sandbox() {
  const base = mkdtempSync(join(tmpdir(), 'quality-gates-'));
  const root = join(base, 'repo');
  const state = join(base, 'state');
  mkdirSync(join(root, '.claude/tests'), { recursive: true });
  mkdirSync(state, { recursive: true });
  return { base, root, state, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

function writeTest(root, name, body) {
  writeFileSync(join(root, '.claude/tests', name), body);
}

function runGates(sb, extraArgs = []) {
  const env = {
    ...process.env,
    CLAUDE_PROJECT_DIR: sb.root,
    HARNESS_STATE_DIR: sb.state,
  };
  // 親が node --test のとき、子の node --test が同じランナーに巻き込まれて
  // 失敗しても exit 0 になる。日常ゲートの入れ子実行を再現するために切る。
  delete env.NODE_TEST_CONTEXT;
  try {
    const stdout = execFileSync('bash', [scriptPath, ...extraArgs], {
      env,
      encoding: 'utf8',
      cwd: sb.root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout };
  } catch (error) {
    return {
      code: error.status ?? -1,
      stdout: String(error.stdout ?? ''),
      stderr: String(error.stderr ?? ''),
    };
  }
}

const PASSING = `import { test } from 'node:test';
test('ok', () => {});
`;
const FAILING = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('dormant should not run by default', () => {
  assert.fail('review-readiness を既定ゲートで実行してはいけない');
});
`;

test('package.json が無くても node --test に落ち、休眠テストは既定で走らない', () => {
  const sb = sandbox();
  try {
    writeTest(sb.root, 'alpha.test.mjs', PASSING);
    writeTest(sb.root, 'review-readiness.test.mjs', FAILING);
    const result = runGates(sb);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /✓ PASS: harness/);
    assert.match(result.stdout, /SKIP\/unknown: lint \(unavailable\)/);
    assert.doesNotMatch(result.stdout, /review-readiness\.test\.mjs/);
  } finally {
    sb.cleanup();
  }
});

test('--all は休眠中の review-readiness 試験も含める', () => {
  const sb = sandbox();
  try {
    writeTest(sb.root, 'alpha.test.mjs', PASSING);
    writeTest(sb.root, 'review-readiness.test.mjs', FAILING);
    const result = runGates(sb, ['--all']);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /✗ FAIL: harness/);
    assert.match(result.stdout, /review-readiness\.test\.mjs/);
  } finally {
    sb.cleanup();
  }
});
