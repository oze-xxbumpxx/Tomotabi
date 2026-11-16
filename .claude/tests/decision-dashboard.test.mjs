// decision-dashboard.mjs（検討ダッシュボードのデータ検査とHTMLの組み立て）のテスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATE_PATH, embedJson, main, renderPage, validateState } from '../scripts/decision-dashboard.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_PATH = join(here, '../skills/visualize-decision/example.json');
const example = () => JSON.parse(readFileSync(EXAMPLE_PATH, 'utf8'));

const question = (over = {}) => ({
  id: 'q-one',
  type: 'question',
  state: 'waiting',
  kind: '設計',
  label: '例の問い',
  options: [
    { key: 'A', title: 'a', pros: 'p', cons: 'c' },
    { key: 'B', title: 'b', pros: 'p', cons: 'c' },
  ],
  recommend: 'A',
  reason: '理由',
  ...over,
});

test('見本のデータは検査を通り、HTMLにできる', () => {
  assert.deepEqual(validateState(example()), []);
  const html = renderPage(example(), readFileSync(TEMPLATE_PATH, 'utf8'));
  assert.match(html, /<title>本の登録画面の保存ボタン<\/title>/);
  assert.doesNotMatch(html, /__STATE__|__TITLE__/);
});

test('推奨・理由・選択肢が欠けた問いは止める', () => {
  const noRec = validateState({ title: 't', items: [question({ recommend: 'Z' })] });
  assert.ok(noRec.some((e) => e.includes('推奨')));
  const noReason = validateState({ title: 't', items: [question({ reason: '' })] });
  assert.ok(noReason.some((e) => e.includes('理由')));
  const oneOption = validateState({ title: 't', items: [question({ options: [{ key: 'A', title: 'a', pros: 'p', cons: 'c' }] })] });
  assert.ok(oneOption.some((e) => e.includes('2つ以上')));
});

test('利点か欠点の無い選択肢と、重なったkeyを止める', () => {
  const errors = validateState({
    title: 't',
    items: [question({ options: [{ key: 'A', title: 'a', pros: 'p' }, { key: 'A', title: 'b', pros: 'p', cons: 'c' }] })],
  });
  assert.ok(errors.some((e) => e.includes('欠点')));
  assert.ok(errors.some((e) => e.includes('重なっている')));
});

test('回答待ちが10件を超えたら止める', () => {
  const items = Array.from({ length: 11 }, (_, i) => question({ id: `q-${i}` }));
  assert.ok(validateState({ title: 't', items }).some((e) => e.includes('10件以内')));
});

test('回答待ちにはkindが要り、決定済みにはdecision.choiceが要る', () => {
  assert.ok(validateState({ title: 't', items: [question({ kind: '' })] }).some((e) => e.includes('kind')));
  const decided = { id: 'd', type: 'question', state: 'decided', label: 'x' };
  assert.ok(validateState({ title: 't', items: [decided] }).some((e) => e.includes('decision.choice')));
});

test('idの重複・形の誤りを止める', () => {
  const errors = validateState({ title: 't', items: [question(), question(), question({ id: 'Bad_Id' })] });
  assert.ok(errors.some((e) => e.includes('重なっている')));
  assert.ok(errors.some((e) => e.includes('英小文字')));
});

test('図と見本のscript・on*属性・javascript:を止める', () => {
  const bad = (figure) => validateState({ title: 't', items: [question({ panels: [{ title: 'p', figure }] })] });
  assert.ok(bad('<svg><script>1</script></svg>').length > 0);
  assert.ok(bad('<svg onload="x()"></svg>').length > 0);
  assert.ok(bad('<a href="javascript:x()">a</a>').length > 0);
  assert.ok(bad('<svg/onload=alert(1)>').length > 0);
  assert.ok(bad('<svg><animate attributeName="x"/></svg>').length > 0);
  assert.deepEqual(bad('<svg viewBox="0 0 1 1"><rect/></svg>'), []);
  const mock = validateState({ title: 't', items: [question({ options: [{ key: 'A', title: 'a', pros: 'p', cons: 'c', mock: '<img onerror=x>' }, { key: 'B', title: 'b', pros: 'p', cons: 'c' }] })] });
  assert.ok(mock.some((e) => e.includes('mock')));
});

test('作業にはbodyかstepsが要る', () => {
  const task = { id: 't1', type: 'task', state: 'waiting', label: '見る' };
  assert.ok(validateState({ title: 't', items: [task] }).length > 0);
  assert.deepEqual(validateState({ title: 't', items: [{ ...task, steps: ['開く'] }] }), []);
});

test('stepsとpanelsの形の誤りは、例外でなく誤りとして返す', () => {
  const task = { id: 't1', type: 'task', state: 'waiting', label: '見る', body: '確認する' };
  assert.ok(validateState({ title: 't', items: [{ ...task, steps: '画面を開く' }] }).some((e) => e.includes('steps')));
  assert.ok(validateState({ title: 't', items: [{ ...task, steps: [1] }] }).some((e) => e.includes('steps')));
  assert.ok(validateState({ title: 't', items: [question({ panels: { title: 'p' } })] }).some((e) => e.includes('panels')));
});

test('選択肢の無い決定済みの問いは通る', () => {
  const decided = { id: 'd', type: 'question', state: 'decided', label: 'x', decision: { choice: 'A' } };
  assert.deepEqual(validateState({ title: 't', items: [decided] }), []);
});

test('埋め込むJSONは</script>で閉じられない', () => {
  const s = embedJson({ x: '</script><script>alert(1)</script>' });
  assert.ok(!s.includes('<'));
  assert.equal(JSON.parse(s).x, '</script><script>alert(1)</script>');
});

test('タイトルのHTMLは逃がして埋める', () => {
  const html = renderPage({ title: 'A <b>&', items: [question()] }, '<title>__TITLE__</title><script>__STATE__</script>');
  assert.match(html, /<title>A &lt;b&gt;&amp;<\/title>/);
});

test('checkとbuildの終了コード', () => {
  const dir = mkdtempSync(join(tmpdir(), 'decision-'));
  try {
    const quiet = { log: () => {}, err: () => {} };
    const good = join(dir, 'good.json');
    const bad = join(dir, 'bad.json');
    writeFileSync(good, JSON.stringify(example()));
    writeFileSync(bad, JSON.stringify({ title: '', items: [] }));
    assert.equal(main(['check', good], quiet), 0);
    assert.equal(main(['check', bad], quiet), 1);
    assert.equal(main(['check', join(dir, 'none.json')], quiet), 2);
    assert.equal(main(['build', good], quiet), 2);
    const out = join(dir, 'out/page.html');
    assert.equal(main(['build', good, '--out', out], quiet), 0);
    assert.match(readFileSync(out, 'utf8'), /id="state"/);
    assert.equal(main(['build', bad, '--out', out], quiet), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
