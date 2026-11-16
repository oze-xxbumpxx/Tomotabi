# 実装計画: migration-workflow（migrationを出先からも流せるようにする）

- 前提となる設計書: docs/designs/migration-workflow.md
- 要件定義: docs/requirements/migration-workflow.md（PR #362で承認）
- 試験計画: docs/tests/migration-workflow.md
- レベル: L3
- 実装ルート: Devin委譲（承認済みのタスクだけ）
- 判断理由: 実装はDevinで行う（2026-11-15 ユーザーの指示）。秘密とワークフローの権限を扱うので、DevinのPRのレビューで`security-reviewer`を起動する。GitHubの設定と検証用での確かめは、ユーザーとClaude Codeが行う。

## 進め方

| 順  | 何を                                                                                                         | 誰が                         |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| 1   | `migration-deploy-check`を実装して出す（`docs/implementation-plans/migration-deploy-check.md`のタスク`all`） | Devin。レビューはClaude Code |
| 2   | この計画のタスク`workflow`を実装する                                                                         | Devin。レビューはClaude Code |
| 3   | Environmentを2つ作り、保護を付け、秘密と変数を置く                                                           | ユーザー（手順書のとおり）   |
| 4   | 検証用で手の確かめ（試験計画のMW-40〜MW-47）                                                                 | ユーザーとClaude Code        |

2は1のPRのマージのあとに渡す（`compareMigrations`と`check-deployed-migrations.mjs`が要るため）。

## 変更対象ファイル

| path                                               | なぜ変えるか                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `.github/scripts/check-deployed-migrations.mjs`    | 止めたときの案内の文を、migrationのボタンの案内に変える                                              |
| `.claude/tests/check-deployed-migrations.test.mjs` | 案内の文を確かめている観点を直す                                                                     |
| `docs/designs/migration-deploy-check.md`           | 止めたときの案内の文                                                                                 |
| `docs/runbooks/integration-env.md`                 | migration専用のEnvironmentの作り方、ボタンでの流し方、止まったときの表、パスワードを替えたときの手順 |
| `docs/runbooks/production.md`                      | 同じ。10章の2（migrationを流す手順）に、ボタンと端末の2通りを書く                                    |
| `.github/pull_request_template.md`                 | 「マージのあとの作業」の欄の説明に、ボタンの名前を足す                                               |

## 新規作成ファイル

| path                                        | 役割                                   |
| ------------------------------------------- | -------------------------------------- |
| `.github/workflows/migrate-integration.yml` | 検証用のボタン                         |
| `.github/workflows/migrate-production.yml`  | 本番のボタン                           |
| `.github/workflows/migrate-db.yml`          | 共通の手順（planとapplyの2つのジョブ） |
| `.github/scripts/plan-migrations.mjs`       | 承認の前の一覧を作る                   |
| `.claude/tests/plan-migrations.test.mjs`    | 上の試験                               |
| `.claude/tests/migrate-workflow.test.mjs`   | ワークフローの形の試験                 |

## ファイルごとの変更内容

下のタスクの「やること」と、設計書の「バックエンド設計」に書く。

## 実装手順

<!-- delegation-task:workflow -->

## 目的

管理者が、スマートフォンからでもmigrationを流せるように、GitHub Actionsに承認つきの手動のワークフロー（検証用と本番のボタン）を足す。L3、ユーザー承認: 済み（要件とADR-0011はPR #362、設計と実装計画はこの計画のPRで承認）。`migration-deploy-check`のPRがマージされてから始める。

## 読む資料

- 設計書: `docs/designs/migration-workflow.md`（「バックエンド設計」「エラー処理」「セキュリティ」）
- 要件: `docs/requirements/migration-workflow.md`、ADR-0011（`docs/decisions/ADR-0011-migration-by-manual-workflow.md`）
- 試験計画: `docs/tests/migration-workflow.md`（MW-01〜MW-39）
- 今の作り: `.github/workflows/deploy-integration.yml`・`deploy-production.yml`・`deploy-vercel.yml`、`.github/scripts/check-deployed-migrations.mjs`、`.claude/tests/deploy-integration-workflow.test.mjs`

## やること

- [ ] `.github/scripts/plan-migrations.mjs`: 今動いているapiの`GET /api/health/migrations`と、流すcommitの`_journal.json`を比べ、`state`（`none`・`pending`・`unknown`）と`count`を決める。比べる関数は`check-deployed-migrations.mjs`の`compareMigrations`をimportして使う。判定は設計書の表のとおり。実行のまとめ（`GITHUB_STEP_SUMMARY`。読みに行ったapiのホスト名も書く）と出力（`GITHUB_OUTPUT`）に書く。Node 24の`fetch`だけで動かし、直接動かしたときだけ本体を動かす。
- [ ] `.github/workflows/migrate-db.yml`（`workflow_call`）: planのジョブ（Environmentなし。秘密を読まない）と、applyのジョブ（`needs: plan`、`state`が`none`でないときだけ、migration専用のEnvironment）。手順は設計書の「planのジョブ」「applyのジョブ」のとおり。
- [ ] `.github/workflows/migrate-integration.yml`・`migrate-production.yml`（`workflow_dispatch`、入力`sha`）: Environmentの名前とapiのURLの変数を渡して`migrate-db.yml`を呼ぶ。秘密は渡さない（applyのジョブが自分のEnvironmentの秘密を読む）。実行の名前、`concurrency`、`permissions`はデプロイのボタンと同じ形にする。本番は、バックアップの確かめの文を出す印を渡す。
- [ ] 入力と変数は、環境変数で受けてから使う。`run`の中に`${{ inputs.… }}`を直接書かない。
- [ ] applyは、`MIGRATION_DATABASE_URL`を環境変数で渡して`npm run db:migrate -w @tomotabi/api`を動かす。渡すのは使う手順（秘密の確認、流す前の時刻、流す、流したあとの時刻）の`env`だけにして、ジョブの`env`と`npm ci`の手順には置かない。流す前後の時刻を`.github/scripts/read-last-migration-time.mjs`で読み、流したmigrationの名前をまとめに書く（流す前の時刻を読む手順が成功したあとは、流す手順が失敗しても動かす）。Drizzleは1回に流すmigrationを1つのトランザクションにまとめるので、失敗したときは流す前後の時刻が同じになる。そのときは「何も流れていません。流す前の状態のままです」と書く。
- [ ] `check-deployed-migrations.mjs`が止めるときの案内の文を、「`migrate-integration`（本番は`migrate-production`）のボタンで流してください。端末からも流せます」に変える。設計書の同じ文も直す。
- [ ] 手順書2つに、次を足す。migration専用のEnvironmentの作り方（保護を付けてから秘密を置く順）、リポジトリの変数2つ、ボタンでの流し方、止まったときの表、migratorのパスワードを替えたときに秘密を入れ直すこと、リポジトリを非公開にすると承認が使えなくなること。本番の10章の2は、バックアップを取って照合してから、ボタンか端末で流す、と書く。
- [ ] PRのひな形の「マージのあとの作業」の説明に、ボタンの名前を足す。

## テスト

- [ ] 試験計画のMW-01〜MW-17を`.claude/tests/plan-migrations.test.mjs`に、MW-20〜MW-33・MW-38・MW-39を`.claude/tests/migrate-workflow.test.mjs`に、MW-34〜MW-37を`.claude/tests/read-last-migration-time.test.mjs`に書く。
- [ ] `.claude/tests/check-deployed-migrations.test.mjs`の、案内の文を確かめている観点を直す。
- [ ] `npm run test:harness`が通る。

## やらないこと

- ワークフローを動かすこと、GitHubのEnvironment・秘密・変数を作ること（ユーザーが行う）。
- `deploy-vercel.yml`・`deploy-integration.yml`・`deploy-production.yml`の変更。
- apiとwebのコード、DBの変更。
- 本番のバックアップをワークフローで取ること、migrationを戻すボタン。
- 試験計画のMW-40〜MW-47（検証用での手の確かめ）。

## 完了条件

- `npm run lint` / `npm run type-check` / `npm test` / `npm run build`が通る。
- `npm run test:harness`が通る。
- PRの説明に、ユーザーが行う設定（Environment 2つ、秘密2つ、変数2つ）を「マージのあとの作業」として書く。
<!-- /delegation-task -->

## 依存関係

- タスク`workflow`は、`migration-deploy-check`のPRのマージのあと。
- 検証用での確かめ（MW-40〜MW-47）は、タスク`workflow`のマージと、ユーザーの設定のあと。

## テスト計画

`docs/tests/migration-workflow.md`のとおり。

## リスク

| リスク                                                                                 | いつ分かるか    | どうするか                                                                                                                       |
| -------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 呼ばれる側のワークフロー（`workflow_call`）で、Environmentの秘密を読む書き方が合わない | レビュー、MW-41 | 呼ぶ側で`secrets: inherit`を使わず、applyのジョブが自分の`environment`の秘密を直接読む形にする。合わなければ止めてユーザーに聞く |
| `drizzle-kit migrate`のログに接続先が出る                                              | MW-45           | 出ていたら、出力を伏せる形に直してから本番で使う                                                                                 |
| 流すcommitが古く、`npm ci`や`db:migrate`の形が今と違う                                 | applyの実行     | `main`の最新を既定にし、古いSHAを入れるのは戻すときだけにする（手順書に書く）                                                    |
| Devinがワークフローを試しに動かそうとする                                              | DevinのPR       | タスクの「やらないこと」に書いた。動かしていたら、レビューで止める                                                               |

## ロールバック方法

ワークフローの3つのファイルとスクリプトを消すPRを出す。ユーザーがEnvironmentと秘密を消し、migratorのパスワードを替える。DBは変えていない。

## ドキュメント更新対象

- 手順書2つ、PRのひな形、`docs/designs/migration-deploy-check.md`（タスクの中で直す）。
- ADR-0011の「Migration」の手順が済んだら、公開の記録に書く（ユーザーの設定のあと）。
