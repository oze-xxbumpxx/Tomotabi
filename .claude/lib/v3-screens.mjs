// v3の画面一式から、番号の画面を撮る（確認のページに載せるため）。
// 設計: docs/designs/discussion-page-v2.md
//
// 方針:
// - 撮るのは記録に残した「v3の版」（コミット）のv3。ファイルは作業ツリーではなく`git show`で読む。
//   v3があとで変わっても、決めたときと同じ画面になる。
// - v3は`support.js`がページ自身をfetchするので、file://では描けない。Playwrightの横取りで、
//   架空の置き場（http://v3.invalid/）からGitの中身を返す。
// - v3が読み込むunpkg.comの部品（React・ReactDOM・Phosphorのアイコン）は版の入ったURLなので、
//   一度取れば置き場の写しを返す。ほかの外への読み込みは止める。
// - 置き場の名前の決め方・番号の読み方は純粋関数にしてテストする。Chromiumで撮る部分はテストしない。

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export const V3_DIR = 'docs/design/handoff-v3';
export const V3_FILE = 'Tomotabi 画面一式 v3.dc.html';
const V3_HOST = 'v3.invalid';
const SCREEN_NO = /^[0-9]{2}[a-z]?$/;

export class V3Error extends Error {}

/**
 * 記録の「画面」の値（`v3 09, v3 10`）を番号の一覧にする。形が違うものはbadに入れる。
 * @param {string} value
 * @returns {{numbers: string[], bad: string[]}}
 */
export function parseScreenList(value) {
  const numbers = [];
  const bad = [];
  for (const part of String(value ?? '').split(/[,、]/)) {
    const item = part.trim();
    if (item === '') continue;
    const m = item.match(/^v3 ([0-9]{2}[a-z]?)$/);
    if (m) {
      if (!numbers.includes(m[1])) numbers.push(m[1]);
    } else bad.push(item);
  }
  return { numbers, bad };
}

/** 撮った画面の置き場での名前。版と番号で決まる。 */
export function shotFile(version, no) {
  if (!/^[0-9a-f]{7,40}$/.test(version)) throw new V3Error(`v3の版「${version}」はコミットの番号ではない`);
  if (!SCREEN_NO.test(no)) throw new V3Error(`画面の番号「${no}」の形が違う`);
  return `${version}-${no}.jpg`;
}

/** 版ごとの画面の名前の一覧（番号→名前）の置き場での名前。 */
export function labelsFile(version) {
  return `${version}-labels.json`;
}

/**
 * unpkg.comの部品のURLを、置き場の写しの相対パスにする。unpkg.com以外と、版の無いURLはnull（止める）。
 * @param {string} url
 */
export function vendorFile(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.host !== 'unpkg.com' || u.search !== '') return null;
  const segments = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (segments.length < 2 || segments.some((s) => s === '.' || s === '..' || s.includes('\\'))) return null;
  // 中身が変わらないと言えるのは、版（@1.2.3）の入ったURLだけ
  const pkgAt = segments[0].startsWith('@') ? segments[1] : segments[0];
  if (!/@\d+\.\d+\.\d+/.test(pkgAt ?? '')) return null;
  return join('unpkg.com', ...segments);
}

function git(root, args, opts = {}) {
  return execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

/** v3を最後に変えたコミット（短い番号）。 */
export function currentV3Version(root) {
  const v = git(root, ['log', '-1', '--format=%h', '--abbrev=8', '--', V3_DIR], { encoding: 'utf8' }).trim();
  if (!v) throw new V3Error(`${V3_DIR} のコミットが見つからない`);
  return v;
}

/** v3にコミットしていない変更があるか。 */
export function v3HasChanges(root) {
  return git(root, ['status', '--porcelain', '--', V3_DIR], { encoding: 'utf8' }).trim() !== '';
}

export function versionExists(root, version) {
  try {
    git(root, ['cat-file', '-e', `${version}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function loadPlaywright(root) {
  try {
    return createRequire(join(root, 'e2e/package.json'))('playwright');
  } catch {
    throw new V3Error('Playwrightが見つからない。`npm install`と`npx playwright install chromium`をしてから');
  }
}

function contentType(name) {
  if (name.endsWith('.html')) return 'text/html; charset=utf-8';
  if (name.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (name.endsWith('.css')) return 'text/css; charset=utf-8';
  if (name.endsWith('.woff2')) return 'font/woff2';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

/**
 * 番号の画面を撮る。置き場にあれば撮り直さない。
 * v3の部品を取れず描けないときは、画面なしで返す（offline: true）。
 * @param {{root: string, version: string, numbers: string[], cacheDir: string, timeoutMs?: number}} args
 * @returns {Promise<{screens: Map<string, {name: string, src: string | null}>, offline: boolean}>}
 */
export async function captureScreens({ root, version, numbers, cacheDir, timeoutMs = 20000 }) {
  const screens = new Map();
  if (numbers.length === 0) return { screens, offline: false };
  mkdirSync(cacheDir, { recursive: true });
  const labelsPath = join(cacheDir, labelsFile(version));
  let labels = existsSync(labelsPath) ? JSON.parse(readFileSync(labelsPath, 'utf8')) : null;
  const shotPath = (no) => join(cacheDir, shotFile(version, no));
  const toUri = (no) => `data:image/jpeg;base64,${readFileSync(shotPath(no)).toString('base64')}`;

  if (labels && numbers.every((no) => no in labels && existsSync(shotPath(no)))) {
    for (const no of numbers) screens.set(no, { name: labels[no], src: toUri(no) });
    return { screens, offline: false };
  }
  if (labels) {
    const missing = numbers.filter((no) => !(no in labels));
    if (missing.length > 0) throw new V3Error(noScreenMessage(missing, labels));
  }

  const { chromium } = loadPlaywright(root);
  let browser;
  try {
    browser = await chromium.launch();
  } catch {
    throw new V3Error('Chromiumを起動できない。`npx playwright install chromium`をしてから');
  }
  let vendorFailed = false;
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      const u = new URL(url);
      if (u.host === V3_HOST) {
        const name = decodeURIComponent(u.pathname.slice(1));
        if (name === '' || name.split('/').some((s) => s === '..')) return route.fulfill({ status: 404 });
        try {
          const body = git(root, ['show', `${version}:${V3_DIR}/${name}`]);
          return route.fulfill({ body, contentType: contentType(name) });
        } catch {
          return route.fulfill({ status: 404 });
        }
      }
      const rel = vendorFile(url);
      if (!rel) return route.abort();
      const local = join(cacheDir, 'vendor', rel);
      if (existsSync(local)) return route.fulfill({ body: readFileSync(local), contentType: contentType(rel) });
      try {
        const res = await route.fetch();
        if (!res.ok()) throw new Error(String(res.status()));
        const body = await res.body();
        mkdirSync(dirname(local), { recursive: true });
        writeFileSync(local, body);
        return route.fulfill({ body, contentType: contentType(rel) });
      } catch {
        vendorFailed = true;
        return route.abort();
      }
    });
    await page.goto(`http://${V3_HOST}/${encodeURIComponent(V3_FILE)}`);
    try {
      await page.waitForFunction(() => document.querySelector('[id="s01"]') !== null, null, { timeout: timeoutMs });
      await page.evaluate(() => document.fonts.ready.then(() => true));
    } catch {
      if (vendorFailed) return { screens, offline: true };
      throw new V3Error('v3の画面を描けなかった（画面の枠 s01 が出ない。v3の作りが変わった可能性）');
    }
    // 番号の欄は枠の最初の子の、最初の印（番号）と次の文字（名前）
    labels = await page.evaluate(() => {
      const out = {};
      for (const frame of document.querySelectorAll('[id^="s"]')) {
        const no = frame.id.slice(1);
        const head = frame.children[0];
        if (!head || head.children[0]?.textContent.trim() !== no) continue;
        out[no] = head.children[1]?.textContent.trim() ?? '';
      }
      return out;
    });
    writeFileSync(labelsPath, `${JSON.stringify(labels, null, 2)}\n`);
    const missing = numbers.filter((no) => !(no in labels));
    if (missing.length > 0) throw new V3Error(noScreenMessage(missing, labels));
    for (const no of numbers) {
      if (!existsSync(shotPath(no))) {
        const phone = page.locator(`[id="s${no}"] > :nth-child(2)`);
        await phone.scrollIntoViewIfNeeded();
        writeFileSync(shotPath(no), await phone.screenshot({ type: 'jpeg', quality: 70 }));
      }
      screens.set(no, { name: labels[no], src: toUri(no) });
    }
    return { screens, offline: false };
  } finally {
    await browser.close();
  }
}

function noScreenMessage(missing, labels) {
  const all = Object.keys(labels).sort();
  return `v3に画面 ${missing.join('・')} が無い（あるのは ${all[0]}〜${all.at(-1)} の${all.length}画面）`;
}
