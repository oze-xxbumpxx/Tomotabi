# 実装計画: e2e-foundation

- 前提となる設計書: docs/designs/e2e-foundation.md、ADR-0005（2026-10-01 Accepted）
- 試験計画: docs/tests/m2-trips-and-plans.md の M-01〜M-04（この E2E はその自動化。新しい観点 ID は作らない）
- レベル: L2
- 実装ルート: Devin に委譲する（ローカルの SWE-2 high。ユーザーの指示があればクラウド）
- 判断理由: 土台（起動・ログイン・DB の初期化）の不安定さを小さい PR で先に潰すため、2 つに分ける

## PR の分け方

| PR | 範囲 | 手順 | マージ後にできること |
| --- | --- | --- | --- |
| E-1 | 土台と M-01 | 1〜5 | `npm run test:e2e` で M-01 が手元で通る |
| E-2 | M-02〜M-04 と CI | 6〜8 | M-01〜M-04 が CI（`e2e.yml`）で回る |

E-2 は E-1 のマージ後に始める。#91（読み上げ名の直し）のマージ後に E-1 の PR を出す（設計書「フロントエンド設計」）。

## 変更対象ファイル

| path | なぜ変えるか |
| --- | --- |
| `package.json`（ルート） | workspaces に `e2e`、scripts に `test:e2e`（`npm run e2e -w @tomotabi/e2e`） |
| `package-lock.json` | `@playwright/test` の追加 |
| `README.md` | コマンド一覧に `npm run test:e2e` と前提（Docker、初回の `npx playwright install chromium`） |
| `.gitignore` | `e2e/playwright-report/`・`e2e/test-results/` |

## 新規作成ファイル

| path | 役割 |
| --- | --- |
| `e2e/package.json` | `@tomotabi/e2e`（private）。scripts は `e2e` だけ（`test` を置かない） |
| `e2e/tsconfig.json` | ルートの設定を継ぐ。`apps/api` の `createAuth`・`tests/support/database.ts` を相対で import できるように |
| `e2e/playwright.config.ts` | webServer（api・web）、workers 1、Chromium、375×812、retries（CI だけ 1）、trace・screenshot は失敗時 |
| `e2e/scripts/run.mjs` | DB の起動・migration・投入 → 環境変数を決めて `playwright test` → 後片付け |
| `e2e/support/{env,db,auth,seed,fixtures}.ts` | 設計書「変更後構成」のとおり |
| `e2e/tests/m01-flow.spec.ts` | M-01（E-1） |
| `e2e/tests/m02-two-people.spec.ts`・`m03-selected-trip.spec.ts`・`m04-unknown-result.spec.ts` | M-02〜M-04（E-2） |
| `.github/workflows/e2e.yml` | E-2 |

## 実装手順

### E-1: 土台と M-01

1. **スパイク**: `e2e/scripts/run.mjs` で Testcontainers の起動・migration までを書き、設計書「DB 設計」の TRUNCATE が migrator で通ることを確かめる。通らなければ止めて報告する（ADR-0005 Decision 5 の切り替えになる）。
2. **起動**: `playwright.config.ts` の webServer（api・web）。API は `createAuthFromEnv` に必要な環境変数（`DATABASE_URL`・`PUBLIC_APP_ORIGIN`・`BETTER_AUTH_SECRET`・`GOOGLE_CLIENT_ID`/`SECRET`）を渡す。起動が待ち合わせで確実に終わることを確かめる。
3. **ログイン**: `support/auth.ts`。`createAuth(..., { plugins: [testUtils()] })` と `$context.test` でひなたのセッションと Cookie を作り、`context.addCookies` で入れる。`/trips` を開いて旅行 0 件の画面（v3 19）が出れば成功。
4. **fixture と DB の初期化**: `support/fixtures.ts`（`hinataPage`・`aoiPage`、各試験の前に `db.reset()`）。
5. **M-01**: 旅行を作る → 予定 3 件（時刻未定を含む）→ 編集・日の移動・取りやめ → 開始 → 終了 → 終了後の追加。各段で画面の表示（しおりの並び、「取りやめ」、状態のバッジ）を確かめる。
   完了条件: `npm run test:e2e` が手元で 5 回続けて通る。`npm test` と `npm run test:harness` が E2E を起動しない。

### E-2: M-02〜M-04 と CI

6. **M-02・M-03**: 2 つの context で C-5 と「あなたの入力で保存」。ログアウト → Cookie を入れ直す → 旅行一覧 → 旅行を選ぶ → `/` でそのしおり。
7. **M-04**: `page.route` で予定の追加の POST を `route.fetch()` してから `route.abort("failed")` → C-4 → `unroute` →「同じ内容で確認する」→ 10/3 の予定が 1 件だけ。
8. **CI**: `.github/workflows/e2e.yml`（設計書 E2E-R7）。build を事前のステップで行い（`E2E_SKIP_BUILD=1`。web の build には `API_ORIGIN=http://localhost:3101` を渡す）、`npx playwright install --with-deps chromium`、失敗時に artifact。
   完了条件: CI で 5 回続けて通る（`workflow_dispatch` を足して手で回してよい）。各試験について、確かめたい振る舞いを壊すと落ちることを 1 回試し、PR の説明に書く。

## 依存関係

- 1 → 2 → 3 → 4 → 5（E-1）→ 6・7 → 8（E-2）
- E-1 の PR は #91 のマージ後に出す（役割と名前で要素を探すため）。#92 とは独立

## 委譲の仕方

- Issue は `.github/ISSUE_TEMPLATE/devin-task.md` の形で、E-1・E-2 を 1 つずつ作る。「既知の指摘」に、試験は壊したら落ちること（`devin-workflow` §2）、固定の待ち時間を使わないこと、アプリのコードに試験用の口を足さないことを書く。
- 記録は `delegation.mjs init <Issue> --model swe-2-high --level 2`。起動後は `devin-stall-watch.mjs` で見張る。

## テスト計画

設計書「テスト方針」のとおり。E2E 自体の単体テストは作らない（起動スクリプトの分岐が増えたら足す）。

## リスク

設計書「リスク」のとおり。加えて、E-1 のスパイクで TRUNCATE が通らない場合は、手順 1 で止めて ADR-0005 を直す。

## ロールバック方法

`e2e/` と `e2e.yml` を消し、ルートの `package.json`・`package-lock.json`・`README.md`・`.gitignore` の変更を戻す。アプリのコードは変えないので、戻すのはこれだけ。

## ドキュメント更新対象

- README（コマンド一覧）
- `docs/tests/m2-trips-and-plans.md` の M-01〜M-04 に「E2E で自動化（`e2e/tests/…`）」を書き足す（E-2）
