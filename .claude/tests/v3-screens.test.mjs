// v3-screens.mjs（v3の画面を撮る）の純粋な部分のテスト。Chromiumで撮る部分は手元で目で確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { V3Error, labelsFile, parseScreenList, shotFile, vendorFile } from '../lib/v3-screens.mjs';

test('V-01 画面の値: 番号を順に重ならないように読み、形が違うものを分ける', () => {
  assert.deepEqual(parseScreenList('v3 09, v3 14e、v3 09'), { numbers: ['09', '14e'], bad: [] });
  assert.deepEqual(parseScreenList('v3 9, 10, v3 10'), { numbers: ['10'], bad: ['v3 9', '10'] });
  assert.deepEqual(parseScreenList(undefined), { numbers: [], bad: [] });
});

test('V-02 置き場の名前: v3の版と番号で決まり、形の違う版・番号は断る', () => {
  assert.equal(shotFile('9db5634a', '14e'), '9db5634a-14e.jpg');
  assert.equal(labelsFile('9db5634a'), '9db5634a-labels.json');
  assert.throws(() => shotFile('../x', '10'), V3Error);
  assert.throws(() => shotFile('9db5634a', '../10'), V3Error);
});

test('V-03 v3の部品: 版の入ったunpkg.comのURLだけを写しの名前にし、ほかは止める', () => {
  assert.equal(vendorFile('https://unpkg.com/react@18.3.1/umd/react.production.min.js'), 'unpkg.com/react@18.3.1/umd/react.production.min.js');
  assert.equal(vendorFile('https://unpkg.com/@babel/standalone@7.29.0/babel.min.js'), 'unpkg.com/@babel/standalone@7.29.0/babel.min.js');
  assert.equal(
    vendorFile('https://unpkg.com/@phosphor-icons/web@2.1.1/src/bold/Phosphor-Bold.woff2'),
    'unpkg.com/@phosphor-icons/web@2.1.1/src/bold/Phosphor-Bold.woff2',
  );
  for (const url of [
    'https://unpkg.com/react/umd/react.production.min.js', // 版が無い
    'https://unpkg.com/react@latest/index.js',
    'https://unpkg.com/react@18.3.1/../../etc/passwd',
    'https://unpkg.com/react@18.3.1/x.js?module',
    'http://unpkg.com/react@18.3.1/x.js',
    'https://example.com/react@18.3.1/x.js',
    'https://fonts.googleapis.com/css2?family=x',
    'not a url',
  ]) {
    assert.equal(vendorFile(url), null, url);
  }
});
