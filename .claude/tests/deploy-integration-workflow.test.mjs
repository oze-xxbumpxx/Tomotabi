import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');
const onBlockOf = (text) => text.match(/^on:\n([\s\S]*?)(?=\n\S)/m)[1];

// 確かめとデプロイの手順は呼び出し専用に置き、検証用と本番のボタンから呼ぶ（設計書 production-launch）。
const workflow = read('deploy-vercel.yml');
const onBlock = onBlockOf(workflow);
const buttons = {
  'deploy-integration.yml': { environment: 'integration', group: 'deploy-integration' },
  'deploy-production.yml': { environment: 'tomotabi-production', group: 'deploy-production' },
};

test('PW-01・02・03: ボタンはworkflow_dispatchだけで、決まったEnvironmentを呼び出し専用に渡し、同時実行は環境ごとに順に待つ', () => {
  for (const [name, expected] of Object.entries(buttons)) {
    const button = read(name);
    const buttonOn = onBlockOf(button);
    assert.match(buttonOn, /workflow_dispatch:/, name);
    assert.match(buttonOn, /sha:/, name);
    assert.doesNotMatch(buttonOn, /\bpush:|pull_request|pull_request_target|schedule:|workflow_call/, name);
    assert.match(button, /uses: \.\/\.github\/workflows\/deploy-vercel\.yml/, name);
    assert.match(button, new RegExp(`environment: ${expected.environment}\\n`), name);
    assert.match(button, /sha: \$\{\{ inputs\.sha \}\}/, name);
    assert.match(button, /secrets: inherit/, name);
    assert.match(button, new RegExp(`group: ${expected.group}\\n`), name);
    assert.match(button, /queue: max/, name);
    assert.match(button, /cancel-in-progress: false/, name);
    // ボタンは自分で手順を持たない（確かめを1か所にするため）。
    assert.doesNotMatch(button, /steps:/, name);
    // 承認の画面で、出すcommitが見える。
    assert.match(button, new RegExp(`run-name: "${expected.group} \\$\\{\\{ inputs\\.sha \\|\\| 'main latest' \\}\\}"`), name);
    assert.match(button, /contents: read/, name);
    assert.match(button, /actions: read/, name);
    assert.doesNotMatch(button, /: write/, name);
  }
});

test('PW-04: 呼び出し専用はworkflow_callだけで、渡されたEnvironmentを使う', () => {
  assert.match(onBlock, /workflow_call:/);
  assert.match(onBlock, /environment:[\s\S]{0,120}?required: true/);
  assert.match(onBlock, /sha:/);
  assert.doesNotMatch(onBlock, /workflow_dispatch|\bpush:|pull_request|schedule:/);
  assert.match(workflow, /environment: \$\{\{ inputs\.environment \}\}/);
  assert.doesNotMatch(workflow, /environment: integration\b/);
});

test('PW-05（IW-02）: 対象commitのci.ymlの成功を確かめ、成功していなければ止める', () => {
  // status=successで絞るので、そのcommitへの実行が増えても取り逃さない。
  assert.match(workflow, /actions\/workflows\/ci\.yml\/runs\?head_sha=\$SHA&status=success&per_page=1/);
  assert.match(workflow, /if \[ "\$SUCCEEDED" -eq 0 \]; then[\s\S]{0,200}?exit 1/);
});

test('PW-06（IW-03）: vercel buildのあと--prebuiltで出し、apiがwebより前。トークンは--token、set -xは無い', () => {
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

test('PW-06（IW-03b）: deployのURLは先に変数へ受け、webのAPI_ORIGINはvarsの固定URL', () => {
  // echoの引数に直接コマンド置換を置くと、deployが失敗してもechoが成功して空のurlが残る。
  // 変数への代入は置換の終了コードを引き継ぐので、失敗で手順が止まる。
  for (const name of ['API_URL', 'WEB_URL']) {
    assert.match(workflow, new RegExp(`${name}="\\$\\(npx --yes vercel@\\d+\\.\\d+\\.\\d+ deploy --prebuilt --prod --token "\\$VERCEL_TOKEN"\\)"`));
    assert.match(workflow, new RegExp(`echo "url=\\$${name}" >> "\\$GITHUB_OUTPUT"`));
  }
  assert.match(workflow, /API_ORIGIN: \$\{\{ vars\.API_ORIGIN \}\}/);
  assert.doesNotMatch(workflow, /API_ORIGIN: \$\{\{ steps\./);
});

test('PW-05（IW-04）: 対象commitがorigin/mainの履歴に含まれるかを確かめ、含まれなければ止める', () => {
  assert.match(workflow, /if ! git merge-base --is-ancestor "\$SHA" origin\/main; then[\s\S]{0,200}?exit 1/);
});

test('PW-05: 必須の変数と入力は先に確かめ、認証情報は残さない', () => {
  // vars.API_ORIGINが空だと転送先が壊れたままデプロイが成功するので、Vercelの手順より前に止める。
  const originCheck = workflow.indexOf('case "${API_ORIGIN:-}" in');
  const apiDeploy = workflow.indexOf('Deploy api to Vercel');
  assert.ok(originCheck > -1 && apiDeploy > -1 && originCheck < apiDeploy, 'API_ORIGINの確かめはapiを出す手順より前に置く');
  // Environmentに秘密を入れ忘れたら、Vercelの手順の前に止める。
  const tokenCheck = workflow.indexOf('Verify VERCEL_TOKEN is set');
  assert.ok(tokenCheck > -1 && tokenCheck < apiDeploy, 'VERCEL_TOKENの確かめはapiを出す手順より前に置く');
  assert.match(workflow, /if \[ -z "\$\{VERCEL_TOKEN:-\}" \]; then[\s\S]{0,200}?exit 1/);
  assert.match(workflow, /case "\$\{API_ORIGIN:-\}" in[\s\S]{0,200}?https:\/\/\*\) ;;[\s\S]{0,200}?exit 1/);
  // 入力のshaは空でなければ40桁の16進数だけを受け付ける。
  assert.match(workflow, /grep -qE '\^\[0-9a-f\]\{40\}\$'/);
  // checkoutの認証情報は作業場所に残さない（このあと依存のコードを動かすため）。
  assert.match(workflow, /persist-credentials: false/);
});

test('PW-07: 実行の条件: 権限は最小、全体20分、結果を要約に書く', () => {
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /timeout-minutes: 20/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /\$GITHUB_STEP_SUMMARY/);
  // webで失敗したときも、出たapiのURLとcommitを要約に残す。
  assert.match(workflow, /Write deployed URLs to summary[\s\S]{0,200}?if: always\(\)/);
});

// migrationの確かめ（docs/tests/migration-deploy-check.md のMD-30〜32）。
const stepBlock = (name) => {
  const start = workflow.indexOf(`- name: ${name}`);
  assert.ok(start > -1, `${name}の手順がある`);
  const next = workflow.indexOf('\n      - ', start + 1);
  return workflow.slice(start, next === -1 ? undefined : next);
};

test('MD-30: migrationの確かめはsetup-nodeの後、npm ciとapi・webを出す手順より前', () => {
  const setupNode = workflow.indexOf('uses: actions/setup-node@');
  const verify = workflow.indexOf('- name: Verify database migrations are applied');
  const npmCi = workflow.indexOf('- run: npm ci');
  const api = workflow.indexOf('- name: Deploy api to Vercel');
  const web = workflow.indexOf('- name: Deploy web to Vercel');
  assert.ok(setupNode > -1 && setupNode < verify, 'setup-nodeの後');
  assert.ok(verify < npmCi && verify < api && verify < web, 'npm ciとapi・webを出す手順より前');
});

test('MD-31: 確かめるスクリプトはワークフロー側の版から取り出し、出すcommitの_journal.jsonを渡す', () => {
  const tooling = stepBlock('Checkout deploy tooling from the workflow ref');
  assert.match(tooling, /uses: actions\/checkout@v\d+/);
  assert.match(tooling, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(tooling, /path: \.workflow\n/);
  assert.match(tooling, /sparse-checkout: \.github\/scripts\n/);
  assert.match(tooling, /persist-credentials: false/);
  const verify = stepBlock('Verify database migrations are applied');
  assert.match(
    verify,
    /run: node \.workflow\/\.github\/scripts\/check-deployed-migrations\.mjs "\$API_ORIGIN" apps\/api\/drizzle\/meta\/_journal\.json/,
  );
  // 出すcommitのcheckoutは今のまま（inputs.shaを使う）。
  assert.match(workflow, /ref: \$\{\{ inputs\.sha \|\| github\.sha \}\}/);
});

test('MD-32: 確かめは失敗を握りつぶさず、API_ORIGINはenvで渡す', () => {
  const verify = stepBlock('Verify database migrations are applied');
  assert.doesNotMatch(verify, /continue-on-error|if: always\(\)|\|\| true/);
  assert.match(verify, /env:\n\s+API_ORIGIN: \$\{\{ vars\.API_ORIGIN \}\}/);
  assert.doesNotMatch(verify, /run: .*\$\{\{/);
});
