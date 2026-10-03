# Tomotabi

本人とパートナー向けの旅行Webアプリ。いまは **M0（開発基盤と互換性の検証）** までです。旅行・精算・認証は未実装です。

## 採用構成

| 領域 | 内容 |
|---|---|
| 言語 | TypeScript / Node 22.x |
| web | Next.js App Router。`app` → `screens` → `features` → `shared`。機能内は`ui` / `model` / `api` |
| api | NestJSモジュラーモノリス。業務モジュール内はController / UseCase / Service / Domain / Infrastructure / Adapter |
| 契約 | `packages/contracts`に公開APIの型とOpenAPIだけを置く |
| webのAPI通信 | OpenAPIからOrvalでfetch関数とZodスキーマを生成（`apps/web/src/shared/api/generated/`、手編集禁止）。応答はZodで検証し、neverthrowの`ResultAsync`で成功と失敗を返す |
| DB | Drizzle ORM + `pg`。M0の表は検証用`infra.m0_probes`のみ |
| テスト | Vitest（web / api共通ランナー）。APIは`@nestjs/testing`とSupertest。実PostgreSQLはTestcontainers |
| CI | GitHub Actionsのquality / build / api-db |

**Adapterの意味**: このリポジトリではAdapterは **IF定義の置き場** です。一般的なPorts and Adaptersでいう「外部接続の実装」はInfrastructureに置きます。UseCaseはIFに依存し、Service / Infrastructureの実装はModuleで注入します。

## ディレクトリ

```text
apps/web/src/
  app/                 ルートと layout（Server Component）
  screens/home/        画面の組立
  features/foundation/ 検証用 UI / model / api
  shared/              汎用 UI と HTTP
apps/api/src/
  modules/foundation/  6区分の最小接続例（業務機能ではない）
  adapter/transaction/ 共通 UnitOfWork の IF
  infrastructure/      pool と M0 検証 SQL
packages/contracts/    wire 型と foundation OpenAPI
```

未実装のtrips / paymentsなどの空クラスは作っていません。

## 前提

- Node 22.18以上の22.x（orvalの要件。リポジトリは22.23.2で確認）
- Docker Desktopが動いていること（`npm run test:api-db`と`npm run test:e2e`。単体テストとbuildには不要）
- E2Eを初めて動かす前に`npx playwright install chromium`（ブラウザの取得。以後は不要）

## コマンド

```bash
npm install
npm run dev:api    # http://localhost:3001
npm run dev:web    # http://localhost:3000  （/api を 3001 へ転送）
npm run lint
npm run type-check
npm test           # web / api の単体・HTTP。Testcontainers は含まない
npm run test:coverage  # web / api のカバレッジを計測（apps/*/coverage/ に html と coverage-summary.json）
npm run test:api-db
npm run build
npm run test:harness
npm run test:e2e   # Playwright E2E（Docker が必要。DB・API・web を起動して M-01 を流す）
npm run api:generate  # OpenAPI から web の API クライアントを再生成
npm run api:check     # 再生成して差分が無いことを確認（CI でも実行）
```

`DATABASE_URL`が無いときのAPIはin-memoryです。起動確認用であり、実PostgreSQL検証の合格には使いません。PGliteへの自動フォールバックはありません。

```bash
npm run db:check      # migration の整合と、スキーマ変更の生成漏れが無いことを確認（CI でも実行）
```

## ローカルDBとmigration（M1）

DBのスキーマは`apps/api/src/infrastructure/database/schema/`のDrizzle定義が正で、`apps/api/drizzle/`にmigrationのSQL履歴を残します（ADR-0003）。アプリの起動時にmigrationは適用しません。

| ロール | 用途 | 権限 |
|---|---|---|
| `migrator` | migrationの適用（管理者だけ） | スキーマと表の所有、DDL |
| `app_runtime` | APIの実行時接続（`DATABASE_URL`） | 表ごとに必要なDMLだけ（`drizzle/0001_app_runtime_grants.sql`）。`statement_timeout` 5秒 |

```bash
docker compose up -d --wait                  # 初回起動時にロールと DB の権限を作り、healthcheck が通るまで待つ
MIGRATION_DATABASE_URL=postgres://migrator:migrator@127.0.0.1:5432/tomotabi \
  npm run db:migrate -w @tomotabi/api        # identity スキーマを作る。2 回目以降は差分だけ
```

- ローカルのパスワード（`migrator` / `app_runtime`）はcompose.yamlの既定値で、ローカル専用です。本番のロールとパスワードは別の管理手順で作ります。
- 管理手順は2つのSQLに分かれています（`apps/api/db/admin/`）。どちらもsuperuserで、`psql -v ON_ERROR_STOP=1`を付けて実行します。
  1. `create-roles.sql`: ロールの作成。ロールはクラスタ全体で共有されるため、**クラスタごとに1回だけ**。2回目はわざと失敗します（パスワードの変更は`ALTER ROLE`で明示的に行う）。
  2. `grant-database.sql`: DBごとの接続・作成権限。**DBごとに**実行し、何度実行しても同じ結果になります。
- スキーマを変えたら`npm run db:generate -w @tomotabi/api`でmigrationを作り、生成されたSQLをレビューしてコミットします。GRANTなどは`npx drizzle-kit generate --custom`の空ファイルに書きます。
- 表を追加したら、`0001_app_runtime_grants.sql`と同じ形でGRANTのmigrationを追加し、`apps/api/tests/db/identity-schema.db.test.ts`と同じ形で権限テストを足します。
- `DATABASE_URL`をローカルDBに向けると、検証用のfoundationカウンタ（`infra.m0_probes`）は使えません。この表はmigrationに含めていないためです（M2の開始時に撤去予定）。

## 管理CLI：Googleアカウントの初期登録と利用停止（M1-c）

管理者端末でだけ実行します。アプリのHTTPルートには載せません。接続には`MIGRATION_DATABASE_URL`（migratorロール）を使います。

**初期登録（`cli:enroll`）**

Google Cloudで **デスクトップ型** のOAuthクライアントを別途作り、`.env`の`ENROLL_GOOGLE_CLIENT_ID` / `ENROLL_GOOGLE_CLIENT_SECRET`に入れます（リダイレクトURIの登録は不要。クライアントは動作中のポートを自動で使います）。

```bash
MIGRATION_DATABASE_URL=postgres://migrator:migrator@127.0.0.1:5432/tomotabi \
ENROLL_GOOGLE_CLIENT_ID=... ENROLL_GOOGLE_CLIENT_SECRET=... \
  npm run cli:enroll -w @tomotabi/api -- --slot 0   # スロットは 0 か 1
```

表示されるURLをブラウザで開き（5分以内）、表示名・メール・subの末尾4文字を確認して`yes`と入力すると、users → accounts → allowlistを1トランザクションで登録します。重複（同じスロットや同じGoogleアカウント）は失敗して何も残りません。

**利用停止（`cli:disable`）**

```bash
MIGRATION_DATABASE_URL=postgres://migrator:migrator@127.0.0.1:5432/tomotabi \
  npm run cli:disable -w @tomotabi/api -- --slot 0
```

allowlistを`enabled = false`にして、そのユーザーの全セッションを削除します。再実行しても同じ結果で成功します。

## 検証用HTTP

| 方法 | 経路 | 意味 |
|---|---|---|
| GET | `/api/health` | プロセス生存 |
| GET | `/api/foundation/probes` | 検証カウンタ |
| POST | `/api/foundation/probes/increment` | 検証カウンタを1加算 |

公開用のログイン裏口はありません。foundation経路はM0検証専用で、本番公開前に閉じます。

## 確認した依存バージョン

確認環境: Node 22.23.2 / npm 10.9.8（2026-09-11）。lockfileで固定。

| パッケージ | 実測 |
|---|---|
| next | 16.3.4 |
| react / react-dom | 19.3.0 |
| @nestjs/core / common / platform-express / testing | 11.2.3 |
| drizzle-orm | 0.45.2 |
| pg | 8.23.0 |
| vitest | 3.2.7 |
| typescript | 5.9.3 |
| orval | 8.36.0（2026-09-23） |
| zod | 4.6.5（2026-09-23） |
| neverthrow | 8.2.0（2026-09-23） |
| eslint | 9.39.5 |
| @testcontainers/postgresql | 11.14.0 |
| Testcontainersのイメージ | `postgres:16-alpine`（2026-09-12に起動・破棄を確認） |

## 検証結果（2026-09-11）

| 項目 | 結果 |
|---|---|
| 層間依存制約 | PASS。禁止importのfixture 4件をESLintが検知 |
| IF経由のNest DI | PASS。`@nestjs/testing`でInputPort tokenからUseCaseを解決しincrementが成立 |
| web単体 | PASS。5件 |
| api単体 + HTTP | PASS。13件（Supertestでhealth / increment / get） |
| web本番build | PASS（Next.js 16.3.4 Turbopack） |
| api本番build | PASS（`nest build`） |
| 画面入口とClient境界 | PASS。`/`はServer Component。加算UIはClient。表示は「現在の件数: 2」まで確認。rewrite経由のGET/POST `/api/*`も成功 |
| 実PostgreSQL起動・破棄 | PASS（2026-09-12）。Testcontainersで`postgres:16-alpine`を起動し、IF経由のincrement後に破棄。PGliteには置換していない |
| Playwright E2E | 未作成。成功扱いにしていない |
| ハーネス | PASS。`node --test .claude/tests/*.test.mjs` 88件 |

## 残課題（M1以降）

- Better Auth標準表、二人の初期登録、Cookie / Guard
- 本番migrationとruntime権限。`sql/00_validation_prerequisites.sql`は本番migrationではない
- 旅行・予定・支払い・精算・通知
- Playwright E2Eの有効化
- Vercel / Neonの作成と公開（M0対象外）
- GitHub Actionsのactionをcommit SHAで固定する
