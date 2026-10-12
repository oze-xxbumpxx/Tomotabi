import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../../.github/workflows/deploy-integration.yml', import.meta.url), 'utf8');
const onBlock = workflow.match(/^on:\n([\s\S]*?)(?=\n\S)/m)[1];

test('IW-01: きっかけはworkflow_dispatchだけで、environment: integrationを使う', () => {
  assert.match(onBlock, /workflow_dispatch:/);
  assert.match(onBlock, /sha:/);
  assert.doesNotMatch(onBlock, /\bpush:|pull_request|pull_request_target|schedule:/);
  assert.match(workflow, /environment: integration/);
});

test('IW-02: 対象commitのci.ymlの成功を確かめ、成功していなければ止める', () => {
  assert.match(workflow, /actions\/workflows\/ci\.yml\/runs\?head_sha=/);
  assert.match(workflow, /conclusion == "success"/);
  assert.match(workflow, /exit 1/);
});

test('IW-03: vercel buildのあと--prebuiltで出し、apiがwebより前。トークンは--token、set -xは無い', () => {
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const command of ['pull --yes --environment=production', 'build --prod', 'deploy --prebuilt --prod']) {
    assert.match(workflow, new RegExp(`vercel@\\d+\\.\\d+\\.\\d+ ${escape(command)}`));
  }
  const apiIndex = workflow.indexOf('VERCEL_PROJECT_ID_API');
  const webIndex = workflow.indexOf('VERCEL_PROJECT_ID_WEB');
  assert.ok(apiIndex > -1 && webIndex > -1 && apiIndex < webIndex, 'apiの手順はwebの手順より前に置く');
  assert.match(workflow, /--token "\$VERCEL_TOKEN"/);
  assert.match(workflow, /secrets\.VERCEL_TOKEN/);
  assert.doesNotMatch(workflow, /secrets\.(?!VERCEL_TOKEN\b)/);
  assert.doesNotMatch(workflow, /set -x/);
});

test('IW-03b: deployのURLは先に変数へ受け、webのAPI_ORIGINはvarsの固定URL', () => {
  // echoの引数に直接コマンド置換を置くと、deployが失敗してもechoが成功して空のurlが残る。
  // 変数への代入は置換の終了コードを引き継ぐので、失敗で手順が止まる。
  for (const name of ['API_URL', 'WEB_URL']) {
    assert.match(workflow, new RegExp(`${name}="\\$\\(npx --yes vercel@\\d+\\.\\d+\\.\\d+ deploy --prebuilt --prod --token "\\$VERCEL_TOKEN"\\)"`));
    assert.match(workflow, new RegExp(`echo "url=\\$${name}" >> "\\$GITHUB_OUTPUT"`));
  }
  assert.match(workflow, /API_ORIGIN: \$\{\{ vars\.API_ORIGIN \}\}/);
  assert.doesNotMatch(workflow, /API_ORIGIN: \$\{\{ steps\./);
});

test('IW-04: 対象commitがorigin/mainの履歴に含まれるかを確かめ、含まれなければ止める', () => {
  assert.match(workflow, /git merge-base --is-ancestor "\$SHA" origin\/main/);
  assert.match(workflow, /exit 1/);
});

test('実行の条件: 権限は最小、全体20分、結果を要約に書く', () => {
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /timeout-minutes: 20/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /\$GITHUB_STEP_SUMMARY/);
});
