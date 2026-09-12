# Tomotabi

本人とパートナー向けの旅行 Web アプリ。いまは **M0（開発基盤と互換性の検証）** までです。旅行・精算・認証は未実装です。

## 採用構成

| 領域 | 内容 |
|---|---|
| 言語 | TypeScript / Node 22.x |
| web | Next.js App Router。`app` → `screens` → `features` → `shared`。機能内は `ui` / `model` / `api` |
| api | NestJS モジュラーモノリス。業務モジュール内は Controller / UseCase / Service / Domain / Infrastructure / Adapter |
| 契約 | `packages/contracts` に公開 API の型と OpenAPI だけを置く |
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

- Node 22.x（リポジトリは 22.23.2 で確認）
- Docker Desktop が動いていること（`npm run test:api-db` だけ。単体テストと build には不要）

## コマンド

```bash
npm install
npm run dev:api    # http://localhost:3001
npm run dev:web    # http://localhost:3000  （/api を 3001 へ転送）
npm run lint
npm run type-check
npm test           # web / api の単体・HTTP。Testcontainers は含まない
npm run test:api-db
npm run build
npm run test:harness
```

`DATABASE_URL` が無いときの API は in-memory です。起動確認用であり、実 PostgreSQL 検証の合格には使いません。PGlite への自動フォールバックはありません。

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
- ハーネス quality-gates の `pnpm` 固定を npm に合わせる
- GitHub Actions の action を commit SHA で固定する
