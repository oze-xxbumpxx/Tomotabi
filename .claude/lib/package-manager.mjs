#!/usr/bin/env node
// パッケージマネージャー検出。Cookpit 由来の pnpm 固定をやめる。
// 優先順: pnpm-lock.yaml → yarn.lock → bun.lock(b) → package-lock.json / npm-shrinkwrap → npm。
// lockfile が無くても npm を返す（npx / npm run が最も広く入っているため）。

import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DORMANT_HARNESS_TESTS = new Set(['review-readiness.test.mjs']);

/**
 * @param {string} root
 * @param {{ existsSync?: typeof existsSync }} [fs]
 * @returns {'pnpm' | 'yarn' | 'bun' | 'npm'}
 */
export function detectPackageManager(root, fs = { existsSync }) {
  if (fs.existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(join(root, 'bun.lockb')) || fs.existsSync(join(root, 'bun.lock'))) return 'bun';
  return 'npm';
}

/**
 * package.json scripts の起動 argv。
 * @param {'pnpm' | 'yarn' | 'bun' | 'npm'} pm
 * @param {string} script
 * @returns {string[]}
 */
export function scriptArgv(pm, script) {
  if (pm === 'pnpm') return ['pnpm', script];
  if (pm === 'yarn') return ['yarn', script];
  if (pm === 'bun') return ['bun', 'run', script];
  return ['npm', 'run', script];
}

/**
 * ローカル bin（prettier 等）の起動 argv。未インストールなら失敗させる（勝手に DL しない）。
 * @param {'pnpm' | 'yarn' | 'bun' | 'npm'} pm
 * @param {string} bin
 * @param {string[]} [args]
 * @returns {string[]}
 */
export function execArgv(pm, bin, args = []) {
  if (pm === 'pnpm') return ['pnpm', 'exec', bin, ...args];
  if (pm === 'yarn') return ['yarn', 'exec', bin, ...args];
  if (pm === 'bun') return ['bunx', '--no-install', bin, ...args];
  return ['npx', '--no-install', bin, ...args];
}

/**
 * ハーネス試験ファイル。休眠中の review-readiness は既定で除く（D-3）。
 * @param {string[]} files basename または相対パス
 * @param {{ includeDormant?: boolean }} [opts]
 * @returns {string[]}
 */
export function selectHarnessTests(files, { includeDormant = false } = {}) {
  return files.filter((file) => {
    const base = file.split('/').pop();
    if (DORMANT_HARNESS_TESTS.has(base)) return includeDormant;
    return true;
  });
}

export { DORMANT_HARNESS_TESTS };
