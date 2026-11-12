# 実装計画: migration-deploy-check（migrationの流し忘れをデプロイの前に止める）

- 前提となる設計書: docs/designs/migration-deploy-check.md
- 要件定義: docs/requirements/migration-deploy-check.md
- 試験計画: docs/tests/migration-deploy-check.md
- レベル: L3
- 実装ルート: メインのセッション
- 判断理由: 既定。公開の口と実行用のロールの権限を足すので`security-reviewer`の対象になり、デプロイのワークフローも同じPRで変える。分けるとワークフローだけ先に入り、口の無いapiに聞いて404の警告が続く

## 変更対象ファイル

| path                                                                  | なぜ変えるか                                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `apps/api/drizzle/meta/_journal.json`                                 | `0013`の行を足す（`drizzle-kit generate --custom`が書く）                                   |
| `apps/api/src/modules/foundation/controller/health.controller.ts`     | `GET /api/health/migrations`を足す                                                          |
| `apps/api/src/modules/foundation/foundation.module.ts`                | 新しい口・UseCaseを登録する。`DATABASE_URL`の有無でPgとメモリを切り替える（今の作りと同じ） |
| `packages/contracts/openapi/foundation.json`                          | `getMigrationStatus`と`MigrationStatusView`を足す                                           |
| `packages/contracts/src/health.ts`・`packages/contracts/src/index.ts` | `MigrationStatusView`の型を足して公開する                                                   |
| `apps/web/src/shared/api/generated/`（orvalの出力）                   | `npm run api:generate`で作り直す（手で直さない）                                            |
| `.github/workflows/deploy-vercel.yml`                                 | `setup-node`と`npm ci`のあいだに、確かめの手順を2つ足す                                     |
| `.claude/tests/deploy-integration-workflow.test.mjs`                  | 足した2つの手順の位置と中身を確かめる試験を足す                                             |
| `.github/pull_request_template.md`                                    | 「マージのあとの作業」の欄を足す（F-08）                                                    |
| `.claude/skills/implement-change/SKILL.md`                            | `apps/api/drizzle/`を変えたPRでは、その欄にどの環境で流すかを書く決まりを足す（F-08）       |
| `docs/runbooks/production.md`                                         | 10章の5、12章、13章に、確かめの手順・前の版へ戻すとき・apiが落ちているときを書き足す        |
| `docs/runbooks/integration-env.md`                                    | 9章の手順の並びと、止まったときの表に1行足す                                                |

## 新規作成ファイル

| path                                                                                 | 役割                                                                            |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `apps/api/drizzle/0013_app_runtime_read_migrations.sql`                              | `app_runtime`に`drizzle`スキーマの`USAGE`と履歴の表の`SELECT`を足す             |
| `apps/api/drizzle/meta/0013_snapshot.json`                                           | `generate --custom`が作るもの。中身は`0012`と同じ                               |
| `apps/api/src/modules/foundation/adapter/outbound/migration-status.port.ts`          | `MigrationStatusReader`（`lastAppliedAt(): Promise<number \| null>`）とトークン |
| `apps/api/src/modules/foundation/adapter/inbound/get-migration-status.input-port.ts` | UseCaseの入口の型とトークン（`get-probe.input-port.ts`と同じ形）                |
| `apps/api/src/modules/foundation/infrastructure/pg-migration-status.ts`              | `SELECT max(created_at)`を1回。bigintの文字列を`Number`にする                   |
| `apps/api/src/modules/foundation/infrastructure/in-memory-migration-status.ts`       | DBなしで`null`を返す                                                            |
| `apps/api/src/modules/foundation/usecase/get-migration-status.usecase.ts`            | `{ lastAppliedAt }`を返す                                                       |
| `.github/scripts/check-deployed-migrations.mjs`                                      | 確かめるスクリプト。判定の純粋関数`compareMigrations`と、直接実行したときの本体 |
| `.claude/tests/check-deployed-migrations.test.mjs`                                   | スクリプトの試験（`npm run test:harness`で動く）                                |
| `apps/api/tests/http/health-migrations.http.test.ts`                                 | DBなしで、ログインなしに200と`{ lastAppliedAt: null }`が返る                    |
| `apps/api/tests/db/migration-status.db.test.ts`                                      | 全migrationを流したDBで、`app_runtime`の接続から最後の`when`が返る              |

## ファイルごとの変更内容

### `apps/api/drizzle/0013_app_runtime_read_migrations.sql`

- 変更内容: `npm run db:generate -w @tomotabi/api -- --custom --name=app_runtime_read_migrations`で空のファイルと`_journal.json`の行を作り、設計書の2行（`GRANT USAGE ON SCHEMA "drizzle"`・`GRANT SELECT ON "drizzle"."__drizzle_migrations"`）を`--> statement-breakpoint`で区切って書く。先頭に、なぜ足すかのコメントを1〜2行（`0012`と同じ書き方）。
- 完了条件: `npm run db:check -w @tomotabi/api`が通る。`_journal.json`の最後の`when`が`0012`より大きい。

### `packages/contracts/openapi/foundation.json`・`packages/contracts/src/health.ts`

- 変更内容: `/api/health/migrations`の`get`（`operationId: getMigrationStatus`）。200の本文は`MigrationStatusView`（`required: ["lastAppliedAt"]`、`additionalProperties: false`、`lastAppliedAt`は`integer`か`null`）。TypeScriptの型は`{ lastAppliedAt: number | null }`。
- 完了条件: `npm run api:generate`のあと`npm run api:check`が通る。

### `apps/api/src/modules/foundation/`（口・UseCase・Controller・Module）

- 変更内容:
  - `migration-status.port.ts`: `MIGRATION_STATUS_READER`のトークンと`MigrationStatusReader`。JSDocに「`_journal.json`の`when`と同じミリ秒。1本も無ければnull」を書く。
  - `pg-migration-status.ts`: `pool.query('SELECT max(created_at) AS last FROM drizzle.__drizzle_migrations')`。`last`が`null`ならnull、文字列なら`Number(last)`。`Number.isSafeInteger`でなければ例外を投げる（500になり、ワークフローは止める側に数える）。
  - `in-memory-migration-status.ts`: いつも`null`。
  - `get-migration-status.usecase.ts`と入口の型: `execute(): Promise<MigrationStatusView>`。
  - `health.controller.ts`: コンストラクタで入口を受け、`@Get("migrations") @PublicRoute()`を足す。今の`get()`は変えない（DBを読まないまま）。
  - `foundation.module.ts`: `MIGRATION_STATUS_READER`を`useDatabase()`で`PgMigrationStatus(getPool())`か`InMemoryMigrationStatus`に切り替え、`GET_MIGRATION_STATUS_INPUT_PORT`を登録する。
- 完了条件: `npm run type-check`と`npm test -w @tomotabi/api`が通る。`/api/health`の既存の試験（`probe.http.test.ts`のA-15、`server-timing.db.test.ts`の「DBの時間が0」）が変わらず通る。

### `.github/scripts/check-deployed-migrations.mjs`

- 変更内容: 依存なし（Node 24の標準だけ）。次を名前つきでexportする。
  - `lastJournalEntry(journal)`: `entries`の`when`が最大の行。`entries`が無い・空なら例外。
  - `compareMigrations({ journal, response })`: `response`は`{ status, body }`か`{ error }`。設計書の判定の表どおりに`{ result: 'pass' | 'warn' | 'fail', message, missing: string[] }`を返す。`missing`は`when`がDBの時刻より大きい`tag`の全部（DBが`null`なら全部）。
  - `main(argv, { fetchImpl, readFile, summaryPath })`: 引数2つ（`API_ORIGIN`と`_journal.json`のパス）。`${origin}/api/health/migrations`を`AbortSignal.timeout(10_000)`で1回だけ聞く。`warn`は`::warning::`、`fail`は`::error::`で出し、`GITHUB_STEP_SUMMARY`があれば比べた2つの時刻と足りない名前を書く。終了コードを返す。
  - 直接実行されたときだけ（`import.meta.main`）`process.exitCode = await main(...)`。
  - 止めたときの案内は設計書の1文のまま。
- 完了条件: `.claude/tests/check-deployed-migrations.test.mjs`が通る。`node .github/scripts/check-deployed-migrations.mjs`を引数なしで動かすと使い方を出して1で終わる。

### `.github/workflows/deploy-vercel.yml`

- 変更内容: `actions/setup-node@v4`の直後、`npm ci`の前に、設計書のYAMLの2手順（`Checkout deploy tooling from the workflow ref`・`Verify database migrations are applied`）を足す。出すcommitのcheckoutは変えない。
- 完了条件: `deploy-integration-workflow.test.mjs`の新しい試験（試験計画のMD-30〜32）が通る。

### 文書（PRのひな形・`implement-change`・手順書）

- 変更内容:
  - PRのひな形: 「品質確認」の前に「マージのあとの作業」の欄。コメントで「`apps/api/drizzle/`を変えたら、どの環境で、どのmigrationを流すか。無ければ『なし』」。
  - `implement-change`の「やること」に1行: `apps/api/drizzle/`を変えたPRは、PRの説明の「マージのあとの作業」に流す環境とmigrationの名前を書く。
  - `production.md`の10章の5に「apiを出す前に、DBに流したmigrationが出すcommitに追いついているかを確かめる」。12章に「この機能より前のcommitへ戻したあとの1回は、確かめが警告を出して進む」。13章に「apiが落ちていて、原因がDBでないのに確かめで止まるときは、管理者が`Verify database migrations are applied`の手順を一時的に外したPRで出す」。
  - `integration-env.md`の9章の手順の並びに確かめを1つ足し、止まったときの表に`Verify database migrations are applied`の行（原因: migrationの流し忘れ・`0013`の流し忘れで500・apiが落ちている。直し方: 2章の手順でmigrationを流してから押し直す）を足す。
- 完了条件: 文書の`prettier --check`が通る。ひな形と手順書の言葉が`writing-style.md`に沿っている。

## 実装手順

1. migration … `0013`のSQLと`_journal.json`・snapshot / 設計書のGRANT 2行 / `db:check`が通る。
2. 契約 … `foundation.json`・`health.ts`・`index.ts`、`api:generate` / `MigrationStatusView` / `api:check`が通る。
3. apiの口 … `foundation`の6ファイル / 上の「apiの口」の内容 / `type-check`が通る。
4. apiの試験 … `health-migrations.http.test.ts`・`migration-status.db.test.ts` / 試験計画のMD-01〜08 / `npm test`と`npm run test:db -w @tomotabi/api`が通る（DBの試験はDockerが要る。手元に無ければCIの`api-db`で確かめる）。
5. 確かめるスクリプト … `check-deployed-migrations.mjs`とその試験 / 試験計画のMD-10〜27 / `npm run test:harness`が通る。
6. ワークフロー … `deploy-vercel.yml`の2手順と`deploy-integration-workflow.test.mjs` / MD-30〜32 / `npm run test:harness`が通る。
7. 文書 … ひな形・`implement-change`・手順書2つ / 上の「文書」の内容 / `prettier --check`。
8. 品質ゲートと検証 … `bash .claude/scripts/run-quality-gates.sh`、`npm run db:check`、`npm run api:check`。`reviewer`と`security-reviewer`を並行で起動し、指摘を突き合わせて直す。

## 依存関係

- 1は3・4より前（DBの試験は`0013`の権限が無いと`app_runtime`で読めない）。
- 2は3より前（Controllerが`MigrationStatusView`を使う）。
- 5は1〜4と独立。6は5のあと（ワークフローがスクリプトのパスを呼ぶ）。
- 7はどこでもよいが、手順書の手順名は6の名前に合わせる。

## テスト計画

`docs/tests/migration-deploy-check.md`のとおり。置き場所は次のとおり。

- api（DBなし）: `apps/api/tests/http/health-migrations.http.test.ts`（`vitest.config.ts`の`tests/**/*.test.ts`に入る）。
- api（DBつき）: `apps/api/tests/db/migration-status.db.test.ts`（`vitest.db.config.ts`の`tests/**/*.db.test.ts`に入る）。
- スクリプトとワークフロー: `.claude/tests/check-deployed-migrations.test.mjs`と`.claude/tests/deploy-integration-workflow.test.mjs`（`npm run test:harness`の`.claude/tests/*.test.mjs`に入る）。
- 結合検証環境での確かめ（MD-40〜44）は、マージのあと設計書の「移行とリリース」の順で人が見る。

## リスク

| リスク                                                             | いつ気づくか                                    | 手当て（上から順に試す）                                                                                                                              |
| ------------------------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import.meta.main`がCIのNodeで`undefined`になる                    | 手順5の試験・手順6の結合での確かめ              | CIと手元はNode 24（ADR-0008）で使える。`undefined`なら`process.argv[1]`と`fileURLToPath(import.meta.url)`の比較に替える                               |
| `generate --custom`のsnapshotに差分が出て`db:check`が落ちる        | 手順1                                           | 表は変えないので差分は出ない想定。出たら実装を止めて生成の結果を見る                                                                                  |
| 2つ目の`actions/checkout`が出すcommitの作業ツリーを消す            | 手順6のあとの結合での確かめ（MD-40）            | `path: .workflow`で別のフォルダに置くので消さない。消えたら、確かめの2手順を出すcommitのcheckoutより前に動かし、`_journal.json`の読み取りだけ後に回す |
| `.workflow`のフォルダがVercelのビルドに混ざる                      | MD-40                                           | `vercel deploy --prebuilt`は`.vercel/output`だけを上げるので混ざらない想定。混ざったら確かめのあとに`rm -rf .workflow`を足す                          |
| `drizzle`スキーマの持ち主がmigrator以外で、`0013`のGRANTが通らない | 手順4のDBの試験、結合検証環境で`0013`を流すとき | 試験も本番もmigratorが`drizzle-kit migrate`で作るので持ち主はmigrator。通らなければ止めてユーザーに聞く                                               |

## ロールバック方法

- アプリ: 前のcommitを`deploy-vercel`で出す。確かめるスクリプトはワークフロー側の版で動くので、この機能より前のcommitにも戻せる（MD-27・MD-43）。
- 確かめそのものが邪魔になったとき: `Verify database migrations are applied`の手順を外すPRをマージしてから出す。
- DB: `0013`は権限を足すだけで、戻さなくても前の版は動く。戻すなら管理者が`REVOKE`を手で流す（migrationは足さない）。

## ドキュメント更新対象

- `docs/runbooks/production.md`・`docs/runbooks/integration-env.md`・`.github/pull_request_template.md`・`.claude/skills/implement-change/SKILL.md`（上の「文書」）。
- ADR-0003は変えない（migrationを流すのは今までどおり管理者の端末だけ）。
- ドメインモデルの文書は無いので確かめる対象は無い。
- 結合検証環境での確かめの結果は`docs/tests/integration-env.md`ではなく、この機能の試験計画の記録の表に書く。
