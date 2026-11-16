import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ワークフローの形の試験（docs/tests/migration-workflow.mdのMW-20〜33）。
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

test('MW-21: 環境の取り違えが無い（B-03）。本番はバックアップの確かめの文を出す。呼ぶ側は秘密を渡さない', () => {
  for (const [name, expected] of Object.entries(buttons)) {
    const button = read(name);
    assert.match(button, new RegExp(`environment: ${expected.environment}\\n`), name);
    assert.match(button, new RegExp(`${expected.originVar}`), name);
    assert.match(button, /sha: \$\{\{ inputs\.sha \}\}/, name);
    assert.match(button, /uses: \.\/\.github\/workflows\/migrate-db\.yml/, name);
    // 秘密は渡さない。applyのジョブが自分のEnvironmentの秘密を直接読む。
    assert.doesNotMatch(button, /\bsecrets\b/, name);
  }
  assert.doesNotMatch(read('migrate-integration.yml'), /backup_reminder/);
  assert.match(read('migrate-production.yml'), /backup_reminder: true/);
  // 呼ばれる側の秘密はrequired:false。呼ぶ側は秘密を渡さないので、必須にすると
  // 呼び出しが止まる。値はapplyのジョブのenvironmentが解決する。
  const secretDecl = shared.match(/MIGRATION_DATABASE_URL:\n\s+description: "[^"]*"\n\s+required: (true|false)/);
  assert.equal(secretDecl?.[1], 'false');
  assert.match(shared, /呼ぶ側は渡さない/);
});

test('MW-22: planはEnvironmentを持たず、秘密を読まない', () => {
  assert.doesNotMatch(planJob, /^\s+environment:/m);
  assert.doesNotMatch(planJob, /secrets\./);
});

test('MW-23: 秘密を読むのはapplyのジョブの手順だけ。呼ぶ側は秘密を渡さない', () => {
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
  // 呼ぶ側は秘密を渡さない。secrets:の指定（inheritを含む）が無い。
  for (const name of Object.keys(buttons)) {
    assert.doesNotMatch(read(name), /^\s*secrets:/m, name);
  }
  // 呼ばれる側もsecrets: inheritを使わない。
  assert.doesNotMatch(shared, /^\s*secrets:\s*inherit\s*$/m);
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

test('MW-29: スクリプトはワークフロー側の版（github.sha）から取り出す', () => {
  for (const [job, script] of [
    [planJob, 'plan-migrations.mjs'],
    [applyJob, 'read-last-migration-time.mjs'],
  ]) {
    const tooling = stepBlock(job, 'Checkout migration tooling from the workflow ref');
    assert.match(tooling, /ref: \$\{\{ github\.sha \}\}/);
    assert.match(tooling, /path: \.workflow\n/);
    assert.match(tooling, /sparse-checkout: \.github\/scripts\n/);
    assert.match(job, new RegExp(`node \\.workflow\\/.github/scripts/${script.replace('.', '\\.')}`));
  }
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

// `run: |`の中身を、字下げをそろえて取り出す。手順をbashで動かす試験に使う。
const runBody = (step) => {
  const lines = step.split('\n');
  const i = lines.findIndex((line) => /^ {8}run: \|/.test(line));
  assert.ok(i > -1, 'run: |がある');
  const body = [];
  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j];
    if (line.trim() === '') {
      body.push('');
      continue;
    }
    if (!/^ {10}/.test(line)) break;
    body.push(line.slice(10));
  }
  return `${body.join('\n')}\n`;
};

const W10 = 1791384966637;
const W11 = 1794122827791;
const W12 = 1794122838776;
const journalJson = JSON.stringify({
  entries: [
    { idx: 10, when: W10, tag: '0010_notification_grants' },
    { idx: 11, when: W11, tag: '0011_planning_todos' },
    { idx: 12, when: W12, tag: '0012_planning_todos_grants' },
  ],
});

// 報告の手順のrunを、偽の時刻読み取りと_journal.jsonを置いた一時のディレクトリでbashに動かす。
const runReportStep = async ({ before, after, outcome, readFails = false }) => {
  const dir = await mkdtemp(join(tmpdir(), 'mw32-'));
  try {
    const scriptDir = join(dir, '.workflow/.github/scripts');
    await mkdir(scriptDir, { recursive: true });
    await mkdir(join(dir, 'apps/api/drizzle/meta'), { recursive: true });
    await writeFile(join(scriptDir, 'read-last-migration-time.mjs'), fakeReader);
    await writeFile(join(dir, 'apps/api/drizzle/meta/_journal.json'), journalJson);
    const summaryPath = join(dir, 'summary.md');
    const report = stepBlock(applyJob, 'Report applied migrations');
    await writeFile(join(dir, 'report.sh'), runBody(report));
    // GitHubはshellの指定が無い手順をbash -eで動かすので、同じ形で動かす。
    execFileSync('bash', ['-e', 'report.sh'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MIGRATION_DATABASE_URL: 'postgres://u:p@h/db',
        BEFORE: before,
        MIGRATE_OUTCOME: outcome,
        ENVIRONMENT_NAME: 'migrate-integration',
        TARGET_SHA: 'a'.repeat(40),
        GITHUB_STEP_SUMMARY: summaryPath,
        FAKE_AFTER: after,
        FAKE_FAIL: readFails ? '1' : '0',
      },
    });
    return await readFile(summaryPath, 'utf8');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

// 偽の時刻読み取り。新しい読み方（node .workflow/.github/scripts/read-last-migration-time.mjs）に合わせる。
const fakeReader = `if (process.env.FAKE_FAIL === '1') {
  process.stderr.write('DBにつながりませんでした\\n');
  process.exit(1);
}
process.stdout.write(\`\${process.env.FAKE_AFTER}\\n\`);
`;

test('MW-32: 失敗したときの報告。流す前後の時刻が同じで流す手順が失敗なら「何も流れていません」と書く（E-04）', async () => {
  // 報告の手順のrunを実際にbashで動かし、出た文を比べる（文の有無だけでなく、outcomeごとの出し分けを見る）。
  const same = String(W12);
  const okSummary = await runReportStep({ before: same, after: same, outcome: 'success' });
  assert.match(okSummary, /流すものはありませんでした/);
  assert.doesNotMatch(okSummary, /何も流れていません/);

  const failedSummary = await runReportStep({ before: same, after: same, outcome: 'failure' });
  assert.match(failedSummary, /何も流れていません。流す前の状態のままです/);
  assert.doesNotMatch(failedSummary, /流すものはありませんでした/);

  // 時刻が違えば、間のmigrationの名前を流す順に出す。
  const namesSummary = await runReportStep({ before: String(W11), after: same, outcome: 'success' });
  assert.match(namesSummary, /0012_planning_todos_grants/);
  assert.doesNotMatch(namesSummary, /0011_planning_todos/);

  // あとの時刻が読めなくても、手順は動き「読めませんでした」と出す。
  const unreadable = await runReportStep({ before: same, after: '', outcome: 'failure', readFails: true });
  assert.match(unreadable, /流したあとの最後のmigrationの時刻: （読めませんでした）/);
});

test('MW-33: 秘密の確認の手順で接続先を伏せ、流す手順より前にある', () => {
  const verify = stepBlock(applyJob, 'Verify MIGRATION_DATABASE_URL is set');
  assert.match(verify, /::add-mask::/);
  assert.match(verify, /parts\.hostname/);
  assert.match(verify, /parts\.username/);
  assert.match(verify, /parts\.password/);
  assert.match(verify, /unquote/);
  // 値が空のときは登録しない。
  assert.match(verify, /if value/);
  // 値をechoの引数に置かない（標準出力に直接書く）。
  assert.doesNotMatch(verify, /echo[^\n]*add-mask/);
  const posVerify = applyJob.indexOf('- name: Verify MIGRATION_DATABASE_URL is set');
  const posMigrate = applyJob.indexOf('- name: Apply migrations');
  assert.ok(posVerify > -1 && posMigrate > posVerify, '秘密の確認が流す手順より前にある');
});
