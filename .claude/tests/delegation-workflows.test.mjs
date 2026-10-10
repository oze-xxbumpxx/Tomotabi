import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = (name) => readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
const control = workflow('delegation-control');
const listener = workflow('delegation-events');

test('I-18/I-20: writerはmainのrun SHAで動き、PRコードやnpmを実行しない', () => {
  assert.match(control, /issue_comment:\s+types: \[created, edited, deleted\]/);
  assert.match(control, /options: \[initialize, reconcile, review-refresh\]/);
  assert.match(control, /schedule:\s+- cron: '0 \* \* \* \*'/);
  assert.match(control, /workflows: \[delegation-events, ci, e2e\]/);
  assert.doesNotMatch(control, /pull_request(?:_target)?:|check_run:|check_suite:|status:/);
  assert.match(control, /if: github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/);
  assert.match(control, /ref: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(control, /pull_request\.head|workflow_run\.head_sha|npm|npx|body\s*\}\}|run:\s*\$\{\{/);
  const concurrency = control.match(/concurrency:\n((?:  [^\n]*\n)+)/)?.[1] ?? '';
  assert.match(concurrency, /group: tomotabi-delegation-control/);
  assert.match(concurrency, /cancel-in-progress: false/);
  const keys = [...concurrency.matchAll(/^  ([a-z-]+):/gm)].map((match) => match[1]).sort();
  assert.deepEqual(keys, ['cancel-in-progress', 'group']);
  assert.match(control, /name: delegation-control-writer/);
  assert.doesNotMatch(control, /name: agent-review/);
  assert.match(control, /contents: read\s+issues: write\s+pull-requests: read\s+checks: write\s+actions: read/);
  assert.match(control, /run: node \.claude\/scripts\/delegation-control\.mjs/);
});

test('I-18/I-19: listenerはcheckoutと書込権限なし。通知は固定JSONだけ', () => {
  assert.match(listener, /pull_request:\s+types: \[opened, reopened, synchronize, ready_for_review, converted_to_draft, edited, closed\]/);
  assert.match(listener, /pull_request_review:\s+types: \[submitted, edited, dismissed\]/);
  assert.match(listener, /pull_request_review_comment:\s+types: \[created, edited, deleted\]/);
  assert.doesNotMatch(listener, /checkout|write\s*$|pull_request_target|npm|npx|exec\(|eval\(|require\(.*child_process/m);
  assert.match(listener, /Number\.isSafeInteger\(pr\)/);
  assert.match(listener, /schema_version: 1, repository_id: context\.payload\.repository\.id, pr, event: context\.eventName, run_id:/);
  assert.match(listener, /name: delegation-notification\s+path: delegation-notification\/notification\.json/);
  assert.doesNotMatch(listener, /GITHUB_TOKEN|prompt|verdict|body/);
});

test('I-17: quality/build/api-dbとE2Eの既存条件を維持する', () => {
  const ci = workflow('ci');
  const e2e = workflow('e2e');
  for (const name of ['quality', 'build', 'api-db']) assert.match(ci, new RegExp(`name: ${name}\\n`));
  for (const path of ['apps/web/**', 'apps/api/**', 'packages/contracts/**', 'e2e/**', 'package-lock.json', '.github/workflows/e2e.yml']) assert.ok(e2e.includes(`"${path}"`));
  assert.doesNotMatch(ci + e2e, /agent-review|delegation-control/);
});
