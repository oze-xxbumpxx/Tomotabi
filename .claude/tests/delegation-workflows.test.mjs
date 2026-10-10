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
  assert.match(control, /workflows: \[delegation-events\]/);
  assert.doesNotMatch(control, /pull_request(?:_target)?:|check_run:|check_suite:|status:/);
  assert.match(control, /github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/);
  assert.match(control, /ref: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(control, /pull_request\.head|workflow_run\.head_sha|npm|npx|body\s*\}\}|run:\s*\$\{\{/);
  assert.match(control, /group: tomotabi-delegation-control\s+queue: max\s+cancel-in-progress: false/);
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

test('controllerはCI完了と通常コメントを除外し、証拠の編集・削除を取りこぼさない', () => {
  assert.match(control, /workflows: \[delegation-events\]/);
  assert.doesNotMatch(control, /workflows:.*(?:ci|e2e)/);
  const config = JSON.parse(readFileSync(new URL('../config/delegation-review.json', import.meta.url)));
  assert.ok(control.includes(`github.event.issue.number == ${config.management_issue}`));
  assert.ok(control.includes(`github.event.comment.user.id == ${config.actor_ids.codex}`));
  for (const marker of ['tomotabi-delegation-request', 'tomotabi-claude-review', 'codex-pull-request-review-summary']) {
    assert.ok(control.includes(`startsWith(github.event.comment.body, '<!-- ${marker} -->')`));
    assert.ok(control.includes(`startsWith(github.event.changes.body.from, '<!-- ${marker} -->')`));
  }
});

test('writerの実際のif式は通常コメントを省略し、要求と完了証拠の編集・削除は処理する', () => {
  const expression = control.match(/    if: >-\n([\s\S]*?)    runs-on:/)[1].trim();
  const evaluate = new Function('github', 'startsWith', 'format', `return (${expression});`);
  const check = ({ number = 1, pr = false, author = 1, body = '', previous = '', ref = 'refs/heads/main', eventName = 'issue_comment', action = 'created' } = {}) => evaluate({
    ref, event_name: eventName, event: { action, repository: { default_branch: 'main' }, issue: { number, pull_request: pr },
      comment: { user: { id: author }, body }, changes: { body: { from: previous } } },
  }, (value, prefix) => String(value ?? '').startsWith(prefix), (pattern, value) => pattern.replace('{0}', value));
  assert.equal(Boolean(check({ body: '通常コメント' })), false);
  assert.equal(Boolean(check({ number: 191, body: '<!-- tomotabi-delegation-event -->\n{}' })), false);
  assert.equal(Boolean(check({ number: 191, body: '<!-- tomotabi-delegation-request -->\n{}' })), true);
  assert.equal(Boolean(check({ number: 191, previous: '<!-- tomotabi-delegation-request -->\n{}' })), true);
  assert.equal(Boolean(check({ pr: true, body: '通常コメント' })), false);
  assert.equal(Boolean(check({ pr: true, action: 'deleted', body: '', previous: '' })), true);
  assert.equal(Boolean(check({ pr: true, action: 'deleted', body: null, previous: '' })), true);
  assert.equal(Boolean(check({ pr: true, author: 199175422, body: '行外の指摘' })), true);
  for (const marker of ['tomotabi-claude-review', 'codex-pull-request-review-summary']) {
    assert.equal(Boolean(check({ pr: true, body: `<!-- ${marker} -->\n{}` })), true);
    assert.equal(Boolean(check({ pr: true, previous: `<!-- ${marker} -->\n{}`, body: '編集で印が消えた' })), true);
  }
  assert.equal(Boolean(check({ eventName: 'schedule' })), true);
  assert.equal(Boolean(check({ eventName: 'workflow_dispatch' })), true);
  assert.equal(Boolean(check({ eventName: 'workflow_run' })), true);
  assert.equal(Boolean(check({ eventName: 'workflow_dispatch', ref: 'refs/heads/devin/change' })), false);
});
