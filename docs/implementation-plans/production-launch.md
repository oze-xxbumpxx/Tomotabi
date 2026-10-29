# 実装計画: production-launch

- 前提となる設計書: docs/designs/production-launch.md（PR #318で承認）
- レベル: L3
- 実装ルート: メインのセッション
- 判断理由: 既定

## 変更対象ファイル

- `.github/workflows/deploy-integration.yml`: 確かめとデプロイの手順を呼び出し専用のワークフローへ移し、ボタンだけにする。
- `.claude/tests/deploy-integration-workflow.test.mjs`: 呼び出し専用と2つのボタンの形を確かめる試験に直す。
- `.gitignore`: dumpのファイル（`*.dump`・`*.dump.age`）を入れない。
- `docs/旅行アプリ設計 3/詳細設計/運用設定と公開チェック.md`: 1節の環境変数の表のうち、今のコードに無いもの（`PUSH_ENABLED`・`RELEASE_SHA`・`APP_MAINTENANCE_MODE`）と、`BACKUP_DATABASE_URL`の扱いを今の決定に合わせる。
- `docs/runbooks/integration-env.md`: 9章のワークフローの説明を、呼び出し専用に移ったことに合わせる。

## 新規作成ファイル

- `.github/workflows/deploy-vercel.yml`: 呼び出し専用（`workflow_call`）。確かめとデプロイの手順。
- `.github/workflows/deploy-production.yml`: 本番のボタン。
- `apps/api/db/admin/stop-runtime.sql`・`resume-runtime.sql`: 完全停止と再開。
- `apps/api/db/admin/neutralize-restored.sql`: 復元したDBの後始末。
- `apps/api/db/admin/verify-restore.sql`: 照合の数字。
- `apps/api/tests/db/admin-scripts.db.test.ts`: 上の4つの実DBの試験。
- `docs/runbooks/production.md`: 本番の手順書。
- `docs/runbooks/backup-and-restore.md`: バックアップと復元の手順書。
- `docs/releases/README.md`: 公開の記録の置き方とテンプレート。
- `docs/tests/production-launch.md`: 試験計画。

## ファイルごとの変更内容

### `.github/workflows/deploy-vercel.yml`

- 変更内容: `on: workflow_call`（入力`environment`・`sha`）。ジョブに`environment: ${{ inputs.environment }}`。今の`deploy-integration.yml`の手順（SHAの形、`API_ORIGIN`、checkout、mainの履歴、CIの成功、`npm ci`、api、web、要約）をそのまま移す。要約の見出しに環境の名前を入れる。
- 完了条件: 試験が通り、検証用のボタンから呼んで今と同じに出せる（検証用で確かめる）。

### `.github/workflows/deploy-integration.yml`・`deploy-production.yml`

- 変更内容: `workflow_dispatch`（入力`sha`）だけ。`concurrency`（`deploy-integration`・`deploy-production`、`queue: max`）。`uses: ./.github/workflows/deploy-vercel.yml`に`environment`（`integration`・`tomotabi-production`）と`sha`を渡し、`secrets: inherit`。権限は`contents: read`・`actions: read`。
- 完了条件: 試験が通る。

### `apps/api/db/admin/*.sql`

- 変更内容: 設計書「DB 設計」の表のとおり。`neutralize-restored.sql`は、設定`tomotabi.restored_copy`が`yes`でなければ例外で止まる（本番に誤って流さないため）。`verify-restore.sql`はセッション・認証の一時データ・通知の購読の表を数えない。
- 完了条件: 実DBの試験が通る。

### 手順書と公開の記録

- 変更内容: 設計書「手順書」の表のとおり。dumpと復元のコマンドは、`postgres:16-alpine`のコンテナの`pg_dump`・`pg_restore`と`age`を使う。
- 完了条件: 書いたコマンドを、手元のDockerで一度流して確かめる（dump・復元・照合）。

## 実装手順

1. ワークフロー … `deploy-vercel.yml`・`deploy-integration.yml`・`deploy-production.yml`・試験 / 上のとおり / `node --test .claude/tests/deploy-integration-workflow.test.mjs`が通る
2. 管理用のSQL … `apps/api/db/admin/*.sql`・`admin-scripts.db.test.ts` / 上のとおり / `npm run test:api-db`の該当の試験が通る
3. 手順書と記録 … `docs/runbooks/*`・`docs/releases/README.md`・`.gitignore`・設計資料の表 / 上のとおり / 手元のDockerで手順のコマンドが動く
4. 品質ゲートと検証役のレビュー … 全体 / `run-quality-gates.sh`と`reviewer`・`security-reviewer` / 指摘を直す

## 依存関係

手順3の手順書は、手順1・2のファイル名と動きを前提にする。1と2は互いに依存しない。

## テスト計画

docs/tests/production-launch.md。ワークフローは静的な試験（ハーネスの試験）、SQLは実DBの試験（Testcontainers）。本番と検証用での確かめは、手順書に沿ってユーザーとClaude Codeが行う。

## リスク

設計書「リスク」のとおり。実装で特に気をつけるのは、呼び出し専用のワークフローでEnvironmentの変数と秘密が読めるか。マージのあと、検証用のボタンで最初に確かめる。

## ロールバック方法

ワークフローは、このPRをrevertすれば今の`deploy-integration.yml`に戻る。管理用のSQLと手順書は、手作業で流すだけのもので、アプリとDBの動きは変えない。

## ドキュメント更新対象

- 設計資料「運用設定と公開チェック」1節の表（上のとおり）。
- 検証用の手順書の9章。
- ドメインモデルの文書は無いので対象外。
