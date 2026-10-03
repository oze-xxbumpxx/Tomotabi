# 実装計画: e2e-foundation

- 前提となる設計書: docs/designs/e2e-foundation.md、ADR-0005（2026-10-01 Accepted）
- 試験計画: docs/tests/m2-trips-and-plans.mdのM-01〜M-04（このE2Eはその自動化。新しい観点IDは作らない）
- レベル: L2
- 実装ルート: Devinに委譲する（ローカルのSWE-2 high。ユーザーの指示があればクラウド）
- 判断理由: 土台（起動・ログイン・DBの初期化）の不安定さを小さいPRで先に潰すため、2つに分ける

## PRの分け方

| PR | 範囲 | 手順 | マージ後にできること |
| --- | --- | --- | --- |
| E-1 | 土台とM-01 | 1〜5 | `npm run test:e2e`でM-01が手元で通る |
| E-2 | M-02〜M-04とCI | 6〜8 | M-01〜M-04がCI（`e2e.yml`）で回る |

E-2はE-1のマージ後に始める。#91（読み上げ名の直し）のマージ後にE-1のPRを出す（設計書「フロントエンド設計」）。

## 変更対象ファイル

| path | なぜ変えるか |
| --- | --- |
| `package.json`（ルート） | workspacesに`e2e`、scriptsに`test:e2e`（`npm run e2e -w @tomotabi/e2e`） |
| `package-lock.json` | `@playwright/test`の追加 |
| `README.md` | コマンド一覧に`npm run test:e2e`と前提（Docker、初回の`npx playwright install chromium`） |
| `.gitignore` | `e2e/playwright-report/`・`e2e/test-results/` |

## 新規作成ファイル

| path | 役割 |
| --- | --- |
| `e2e/package.json` | `@tomotabi/e2e`（private）。scriptsは`e2e`だけ（`test`を置かない） |
| `e2e/tsconfig.json` | ルートの設定を継ぐ。`apps/api`の`createAuth`・`tests/support/database.ts`を相対でimportできるように |
| `e2e/playwright.config.ts` | webServer（api・web）、workers 1、Chromium、375×812、retries（CIだけ1）、trace・screenshotは失敗時 |
| `e2e/scripts/run.mjs` | DBの起動・migration・投入 → 環境変数を決めて`playwright test` → 後片付け |
| `e2e/support/{env,db,auth,seed,fixtures}.ts` | 設計書「変更後構成」のとおり |
| `e2e/tests/m01-flow.spec.ts` | M-01（E-1） |
| `e2e/tests/m02-two-people.spec.ts`・`m03-selected-trip.spec.ts`・`m04-unknown-result.spec.ts` | M-02〜M-04（E-2） |
| `.github/workflows/e2e.yml` | E-2 |

## 実装手順

### E-1: 土台とM-01

1. **スパイク**: `e2e/scripts/run.mjs`でTestcontainersの起動・migrationまでを書き、設計書「DB設計」のTRUNCATEがmigratorで通ることを確かめる。通らなければ止めて報告する（ADR-0005 Decision 5の切り替えになる）。
2. **起動**: `playwright.config.ts`のwebServer（api・web）。APIは`createAuthFromEnv`に必要な環境変数（`DATABASE_URL`・`PUBLIC_APP_ORIGIN`・`BETTER_AUTH_SECRET`・`GOOGLE_CLIENT_ID`/`SECRET`）を渡す。起動が待ち合わせで確実に終わることを確かめる。
3. **ログイン**: `support/auth.ts`。`createAuth(..., { plugins: [testUtils()] })`と`$context.test`でひなたのセッションとCookieを作り、`context.addCookies`で入れる。`/trips`を開いて旅行0件の画面（v3 19）が出れば成功。
4. **fixtureとDBの初期化**: `support/fixtures.ts`（`hinataPage`・`aoiPage`、各試験の前に`db.reset()`）。
5. **M-01**: 旅行を作る → 予定3件（時刻未定を含む）→ 編集・日の移動・取りやめ → 開始 → 終了 → 終了後の追加。各段で画面の表示（しおりの並び、「取りやめ」、状態のバッジ）を確かめる。
   完了条件: `npm run test:e2e`が手元で5回続けて通る。`npm test`と`npm run test:harness`がE2Eを起動しない。

### E-2: M-02〜M-04とCI

6. **M-02・M-03**: 2つのcontextでC-5と「あなたの入力で保存」。ログアウト → Cookieを入れ直す → 旅行一覧 → 旅行を選ぶ → `/`でそのしおり。
7. **M-04**: `page.route`で予定の追加のPOSTを`route.fetch()`してから`route.abort("failed")` → C-4 → `unroute` →「同じ内容で確認する」→ 10/3の予定が1件だけ。
8. **CI**: `.github/workflows/e2e.yml`（設計書E2E-R7）。buildを事前のステップで行い（`E2E_SKIP_BUILD=1`。webのbuildには`API_ORIGIN=http://localhost:3101`を渡す）、`npx playwright install --with-deps chromium`、失敗時にartifact。
   完了条件: CIで5回続けて通る（`workflow_dispatch`を足して手で回してよい）。各試験について、確かめたい振る舞いを壊すと落ちることを1回試し、PRの説明に書く。

## 依存関係

- 1 → 2 → 3 → 4 → 5（E-1）→ 6・7 → 8（E-2）
- E-1のPRは #91のマージ後に出す（役割と名前で要素を探すため）。#92とは独立

## 委譲の仕方

- Issueは`.github/ISSUE_TEMPLATE/devin-task.md`の形で、E-1・E-2を1つずつ作る。「既知の指摘」に、試験は壊したら落ちること（`devin-workflow` §2）、固定の待ち時間を使わないこと、アプリのコードに試験用の口を足さないことを書く。
- 記録は`delegation.mjs init <Issue> --model swe-2-high --level 2`。起動後は`devin-stall-watch.mjs`で見張る。

## テスト計画

設計書「テスト方針」のとおり。E2E自体の単体テストは作らない（起動スクリプトの分岐が増えたら足す）。

## リスク

設計書「リスク」のとおり。加えて、E-1のスパイクでTRUNCATEが通らない場合は、手順1で止めてADR-0005を直す。

## ロールバック方法

`e2e/`と`e2e.yml`を消し、ルートの`package.json`・`package-lock.json`・`README.md`・`.gitignore`の変更を戻す。アプリのコードは変えないので、戻すのはこれだけ。

## ドキュメント更新対象

- README（コマンド一覧）
- `docs/tests/m2-trips-and-plans.md`のM-01〜M-04に「E2Eで自動化（`e2e/tests/…`）」を書き足す（E-2）
