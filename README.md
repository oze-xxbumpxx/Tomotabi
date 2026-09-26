# Tomotabi

本人とパートナー向けの旅行 Web アプリ。いまは **M0（開発基盤と互換性の検証）** までです。旅行・精算・認証は未実装です。

## 採用構成

| 領域 | 内容 |
|---|---|
| 言語 | TypeScript / Node 22.x |
| web | Next.js App Router。`app` → `screens` → `features` → `shared`。機能内は `ui` / `model` / `api` |
| api | NestJS モジュラーモノリス。業務モジュール内は Controller / UseCase / Service / Domain / Infrastructure / Adapter |
| 契約 | `packages/contracts` に公開 API の型と OpenAPI だけを置く |
| web の API 通信 | OpenAPI から Orval で fetch 関数と Zod スキーマを生成（`apps/web/src/shared/api/generated/`、手編集禁止）。応答は Zod で検証し、neverthrow の `ResultAsync` で成功と失敗を返す |
| DB | Drizzle ORM + `pg`。M0 の表は検証用 `infra.m0_probes` のみ |
| テスト | Vitest（web / api 共通ランナー）。API は `@nestjs/testing` と Supertest。実 PostgreSQL は Testcontainers |
| CI | GitHub Actions の quality / build / api-db |

**Adapter の意味**: このリポジトリでは Adapter は **IF 定義の置き場** です。一般的な Ports and Adapters でいう「外部接続の実装」は Infrastructure に置きます。UseCase は IF に依存し、Service / Infrastructure の実装は Module で注入します。

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

未実装の trips / payments などの空クラスは作っていません。

## 前提

- Node 22.18 以上の 22.x（orval の要件。リポジトリは 22.23.2 で確認）
- Docker Desktop が動いていること（`npm run test:api-db` だけ。単体テストと build には不要）

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
npm run api:generate  # OpenAPI から web の API クライアントを再生成
npm run api:check     # 再生成して差分が無いことを確認（CI でも実行）
```

`DATABASE_URL` が無いときの API は in-memory です。起動確認用であり、実 PostgreSQL 検証の合格には使いません。PGlite への自動フォールバックはありません。

```bash
npm run db:check      # migration の整合と、スキーマ変更の生成漏れが無いことを確認（CI でも実行）
```

## ローカル DB と migration（M1）

DB のスキーマは `apps/api/src/infrastructure/database/schema/` の Drizzle 定義が正で、`apps/api/drizzle/` に migration の SQL 履歴を残します（ADR-0003）。アプリの起動時に migration は適用しません。

| ロール | 用途 | 権限 |
|---|---|---|
| `migrator` | migration の適用（管理者だけ） | スキーマと表の所有、DDL |
| `app_runtime` | API の実行時接続（`DATABASE_URL`） | 表ごとに必要な DML だけ（`drizzle/0001_app_runtime_grants.sql`）。`statement_timeout` 5 秒 |

```bash
docker compose up -d --wait                  # 初回起動時にロールと DB の権限を作り、healthcheck が通るまで待つ
MIGRATION_DATABASE_URL=postgres://migrator:migrator@127.0.0.1:5432/tomotabi \
  npm run db:migrate -w @tomotabi/api        # identity スキーマを作る。2 回目以降は差分だけ
```

- ローカルのパスワード（`migrator` / `app_runtime`）は compose.yaml の既定値で、ローカル専用です。本番のロールとパスワードは別の管理手順で作ります。
- 管理手順は 2 つの SQL に分かれています（`apps/api/db/admin/`）。どちらも superuser で、`psql -v ON_ERROR_STOP=1` を付けて実行します。
  1. `create-roles.sql`: ロールの作成。ロールはクラスタ全体で共有されるため、**クラスタごとに 1 回だけ**。2 回目はわざと失敗します（パスワードの変更は `ALTER ROLE` で明示的に行う）。
  2. `grant-database.sql`: DB ごとの接続・作成権限。**DB ごとに**実行し、何度実行しても同じ結果になります。
- スキーマを変えたら `npm run db:generate -w @tomotabi/api` で migration を作り、生成された SQL をレビューしてコミットします。GRANT などは `npx drizzle-kit generate --custom` の空ファイルに書きます。
- 表を追加したら、`0001_app_runtime_grants.sql` と同じ形で GRANT の migration を追加し、`apps/api/tests/db/identity-schema.db.test.ts` と同じ形で権限テストを足します。
- `DATABASE_URL` をローカル DB に向けると、検証用の foundation カウンタ（`infra.m0_probes`）は使えません。この表は migration に含めていないためです（M2 の開始時に撤去予定）。

## 管理 CLI：Google アカウントの初期登録と利用停止（M1-c）

管理者端末でだけ実行します。アプリの HTTP ルートには載せません。接続には `MIGRATION_DATABASE_URL`（migrator ロール）を使います。

**初期登録（`cli:enroll`）**

Google Cloud で **デスクトップ型** の OAuth クライアントを別途作り、`.env` の `ENROLL_GOOGLE_CLIENT_ID` / `ENROLL_GOOGLE_CLIENT_SECRET` に入れます（リダイレクト URI の登録は不要。クライアントは動作中のポートを自動で使います）。

```bash
MIGRATION_DATABASE_URL=postgres://migrator:migrator@127.0.0.1:5432/tomotabi \
ENROLL_GOOGLE_CLIENT_ID=... ENROLL_GOOGLE_CLIENT_SECRET=... \
  npm run cli:enroll -w @tomotabi/api -- --slot 0   # スロットは 0 か 1
```

表示される URL をブラウザで開き（5 分以内）、表示名・メール・sub の末尾 4 文字を確認して `yes` と入力すると、users → accounts → allowlist を 1 トランザクションで登録します。重複（同じスロットや同じ Google アカウント）は失敗して何も残りません。

**利用停止（`cli:disable`）**

```bash
MIGRATION_DATABASE_URL=postgres://migrator:migrator@127.0.0.1:5432/tomotabi \
  npm run cli:disable -w @tomotabi/api -- --slot 0
```

allowlist を `enabled = false` にして、そのユーザーの全セッションを削除します。再実行しても同じ結果で成功します。

## 検証用 HTTP

| 方法 | 経路 | 意味 |
|---|---|---|
| GET | `/api/health` | プロセス生存 |
| GET | `/api/foundation/probes` | 検証カウンタ |
| POST | `/api/foundation/probes/increment` | 検証カウンタを 1 加算 |

公開用のログイン裏口はありません。foundation 経路は M0 検証専用で、本番公開前に閉じます。

## 確認した依存バージョン

確認環境: Node 22.23.2 / npm 10.9.8（2026-09-11）。lockfile で固定。

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
| Testcontainers のイメージ | `postgres:16-alpine`（2026-09-12 に起動・破棄を確認） |

## 検証結果（2026-09-11）

| 項目 | 結果 |
|---|---|
| 層間依存制約 | PASS。禁止 import の fixture 4 件を ESLint が検知 |
| IF 経由の Nest DI | PASS。`@nestjs/testing` で InputPort token から UseCase を解決し increment が成立 |
| web 単体 | PASS。5 件 |
| api 単体 + HTTP | PASS。13 件（Supertest で health / increment / get） |
| web 本番 build | PASS（Next.js 16.3.4 Turbopack） |
| api 本番 build | PASS（`nest build`） |
| 画面入口と Client 境界 | PASS。`/` は Server Component。加算 UI は Client。表示は「現在の件数: 2」まで確認。rewrite 経由の GET/POST `/api/*` も成功 |
| 実 PostgreSQL 起動・破棄 | PASS（2026-09-12）。Testcontainers で `postgres:16-alpine` を起動し、IF 経由の increment 後に破棄。PGlite には置換していない |
| Playwright E2E | 未作成。成功扱いにしていない |
| ハーネス | PASS。`node --test .claude/tests/*.test.mjs` 88 件 |

## 残課題（M1 以降）

- Better Auth 標準表、二人の初期登録、Cookie / Guard
- 本番 migration と runtime 権限。`sql/00_validation_prerequisites.sql` は本番 migration ではない
- 旅行・予定・支払い・精算・通知
- Playwright E2E の有効化
- Vercel / Neon の作成と公開（M0 対象外）
- GitHub Actions の action を commit SHA で固定する
