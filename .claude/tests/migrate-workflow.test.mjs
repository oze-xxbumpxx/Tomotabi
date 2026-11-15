import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ワークフローの形の試験（docs/tests/migration-workflow.md のMW-20〜32）。
// ファイルを読んで、planにEnvironmentが無いこと・秘密を読むのがapplyだけであること等を確かめる。
const read = (name) => readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');
const onBlockOf = (text) => text.match(/^on:\n([\s\S]*?)(?=\n\S)/m)[1];

const shared = read('migrate-db.yml');
const buttons = {
  'migrate-integration.yml': { environment: 'migrate-integration', originVar: 'MIGRATE_API_ORIGIN_INTEGRATION', group: 'migrate-integration' },
  'migrate-production.yml': { environment: 'migrate-production', originVar: 'MIGRATE_API_ORIGIN_PRODUCTION', group: 'migrate-production' },
};

const jobBlock = (text, name) => {
  const start = text.search(new RegExp(`^  ${name}:`, 'm'));
  assert.ok(start > -1, `${name}のジョブがある`);
  const rest = text.slice(start);
  const next = rest.slice(1).search(/\n  [a-zA-Z]/);
  return next === -1 ? rest : rest.slice(0, next + 1);
};
const planJob = jobBlock(shared, 'plan');
const applyJob = jobBlock(shared, 'apply');

const stepBlock = (text, name) => {
  const start = text.indexOf(`- name: ${name}`);
  assert.ok(start > -1, `${name}の手順がある`);
  const next = text.indexOf('\n      - ', start + 1);
  return text.slice(start, next === -1 ? undefined : next);
};

// `run: |`と`run: <1行>`の中身を全部取り出す。env:で受けてから使う決まりを確かめるため。
const runBlocks = (text) => {
  const blocks = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s+run: \|/.test(line)) {
      const indent = line.match(/^\s*/)[0].length;
      let j = i + 1;
      while (j < lines.length && (lines[j].trim() === '' || lines[j].match(/^\s*/)[0].length > indent)) j++;
      blocks.push(lines.slice(i + 1, j).join('\n'));
      i = j - 1;
    } else if (/^\s+run: \S/.test(line)) {
      blocks.push(line);
    }
  }
  return blocks;
};

test('MW-20: ボタンはworkflow_dispatchだけで動く', () => {
  for (const name of Object.keys(buttons)) {
    const onBlock = onBlockOf(read(name));
    assert.match(onBlock, /workflow_dispatch:/, name);
    assert.match(onBlock, /sha:/, name);
    assert.doesNotMatch(onBlock, /\bpush:|pull_request|pull_request_target|schedule:|workflow_call/, name);
  }
});

test('MW-21: 環境の取り違えが無い（B-03）。本番はバックアップの確かめの文を出す', () => {
  for (const [name, expected] of Object.entries(buttons)) {
    const button = read(name);
    assert.match(button, new RegExp(`environment: ${expected.environment}\\n`), name);
    assert.match(button, new RegExp(`${expected.originVar}`), name);
    assert.match(button, /sha: \$\{\{ inputs\.sha \}\}/, name);
    assert.match(button, /uses: \.\/\.github\/workflows\/migrate-db\.yml/, name);
    // 秘密は名前で渡す（inheritは使わない）。
    assert.match(button, /MIGRATION_DATABASE_URL: \$\{\{ secrets\.MIGRATION_DATABASE_URL \}\}/, name);
    assert.doesNotMatch(button, /^\s*secrets:\s*inherit\s*$/m, name);
  }
  assert.doesNotMatch(read('migrate-integration.yml'), /backup_reminder/);
  assert.match(read('migrate-production.yml'), /backup_reminder: true/);
});

test('MW-22: planはEnvironmentを持たず、秘密を読まない', () => {
  assert.doesNotMatch(planJob, /^\s+environment:/m);
  assert.doesNotMatch(planJob, /secrets\./);
});

test('MW-23: 秘密を読むのはapplyのジョブの使う手順だけ', () => {
  assert.doesNotMatch(planJob, /secrets\./);
  // applyのジョブのenv（stepsより前）にsecrets.が無い。
  const applyHead = applyJob.slice(0, applyJob.indexOf('    steps:'));
  assert.doesNotMatch(applyHead, /secrets\./);
  // MIGRATION_DATABASE_URL: ${{ secrets.…}}の形は、秘密の確認・流す前の時刻・流す・流したあとの時刻の4手順だけ。
  const usages = applyJob.match(/MIGRATION_DATABASE_URL: \$\{\{ secrets\.MIGRATION_DATABASE_URL \}\}/g) ?? [];
  assert.equal(usages.length, 4);
  for (const stepName of [
    'Verify MIGRATION_DATABASE_URL is set',
    'Read last applied migration time (before)',
    'Apply migrations',
    'Report applied migrations',
  ]) {
    assert.match(stepBlock(applyJob, stepName), /MIGRATION_DATABASE_URL: \$\{\{ secrets\.MIGRATION_DATABASE_URL \}\}/, stepName);
  }
  // npm ciの手順にMIGRATION_DATABASE_URLが無い。
  const npmCiStart = applyJob.indexOf('- run: npm ci');
  assert.ok(npmCiStart > -1);
  const npmCi = applyJob.slice(npmCiStart, applyJob.indexOf('\n      - ', npmCiStart));
  assert.doesNotMatch(npmCi, /MIGRATION_DATABASE_URL|secrets\./);
  // 呼ぶ側・呼ばれる側のどこにもsecrets: inheritが無い。
  for (const name of [...Object.keys(buttons), 'migrate-db.yml']) {
    assert.doesNotMatch(read(name), /^\s*secrets:\s*inherit\s*$/m, name);
  }
});

test('MW-24: applyは承認のあと、流すものがあるときだけ動く', () => {
  assert.match(applyJob, /needs: plan/);
  assert.match(applyJob, /environment: \$\{\{ inputs\.environment \}\}/);
  assert.match(applyJob, /needs\.plan\.outputs\.state != 'none'/);
  assert.match(applyJob, /timeout-minutes: 15/);
  assert.match(planJob, /timeout-minutes: 5/);
});

test('MW-25: mainのcommitだけ。planとapplyの両方でSHAの形と履歴を確かめ、applyはplanのSHAを使う', () => {
  for (const [label, job] of [['plan', planJob], ['apply', applyJob]]) {
    assert.match(job, /grep -qE '\^\[0-9a-f\]\{40\}\$'/, label);
    assert.match(job, /git merge-base --is-ancestor "\$SHA" origin\/main/, label);
  }
  // applyは、planが決めたSHA（inputs.shaではない）でcheckoutする。
  assert.match(applyJob, /ref: \$\{\{ needs\.plan\.outputs\.sha \}\}/);
  assert.match(planJob, /ref: \$\{\{ inputs\.sha \|\| github\.sha \}\}/);
});

test('MW-26: 同時に動かない。環境ごとのconcurrencyで順に待つ', () => {
  for (const [name, expected] of Object.entries(buttons)) {
    const button = read(name);
    assert.match(button, new RegExp(`group: ${expected.group}\\n`), name);
    assert.match(button, /queue: max/, name);
    assert.match(button, /cancel-in-progress: false/, name);
  }
});

test('MW-27: 権限はcontents: readだけ', () => {
  for (const name of [...Object.keys(buttons), 'migrate-db.yml']) {
    const text = read(name);
    const permissions = text.match(/^permissions:\n([\s\S]*?)(?=\n\S)/m)[1].trim();
    assert.equal(permissions, 'contents: read', name);
  }
});

test('MW-28: runの中に${{ inputs.…}}を直接書かない（環境変数で渡す）', () => {
  for (const name of [...Object.keys(buttons), 'migrate-db.yml']) {
    for (const block of runBlocks(read(name))) {
      assert.doesNotMatch(block, /\$\{\{/, name);
      assert.doesNotMatch(block, /github\.event\.inputs/, name);
    }
  }
});

test('MW-29: 一覧を作るスクリプトはワークフロー側の版（github.sha）から取り出す', () => {
  const tooling = stepBlock(planJob, 'Checkout migration tooling from the workflow ref');
  assert.match(tooling, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(tooling, /path: \.workflow\n/);
  assert.match(tooling, /sparse-checkout: \.github\/scripts\n/);
  const plan = stepBlock(planJob, 'Plan migrations');
  assert.match(plan, /node \.workflow\/\.github\/scripts\/plan-migrations\.mjs "\$API_ORIGIN" apps\/api\/drizzle\/meta\/_journal\.json/);
});

test('MW-30: 流したあとの報告は失敗しても動き、流す手順は失敗を握りつぶさない', () => {
  const report = stepBlock(applyJob, 'Report applied migrations');
  assert.match(report, /if: always\(\)/);
  const migrate = stepBlock(applyJob, 'Apply migrations');
  assert.doesNotMatch(migrate, /continue-on-error/);
});

test('MW-31: デプロイのワークフローは変えない（F-02）', () => {
  for (const name of ['deploy-vercel.yml', 'deploy-integration.yml', 'deploy-production.yml']) {
    const text = read(name);
    assert.doesNotMatch(text, /db:migrate|MIGRATION_DATABASE_URL/, name);
  }
});

test('MW-32: 失敗したときの報告。流す前後の時刻が同じで流す手順が失敗なら「何も流れていません」と書く（E-04）', () => {
  const report = stepBlock(applyJob, 'Report applied migrations');
  assert.match(report, /何も流れていません。流す前の状態のままです/);
  assert.match(report, /\[ "\$BEFORE" = "\$AFTER" \]/);
  assert.match(report, /MIGRATE_OUTCOME/);
  assert.match(report, /流すものはありませんでした/);
});
