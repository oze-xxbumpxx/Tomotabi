# 設計書: e2e-foundation

- ステータス: draft
- レベル: L2（新しい workspace・CI のワークフロー。アプリのコードは変えない）
- 関連: ADR-0005（E2E テスト（Playwright）の構成。2026-10-01 Accepted）、docs/tests/m2-trips-and-plans.md の M-01〜M-04、logs/2026-09-30.md（M2-e）

## 背景

M2-e の手動確認で、M-02（二人での競合）は 2 人目のアカウントが無く同じアカウントのタブ 2 つで代わりに確かめ、M-04（結果不明）はスキップした。web と API をつないだ振る舞い（Cookie、rewrites、ETag、同じ要求での確認）は手動でしか確かめていない。M3 の IndexedDB による復帰は実ブラウザでしか確かめにくい。ADR-0005 で構成を決めた。この設計書は、ADR の決定を実装できる粒度に落とす。

## 目的

- M-01〜M-04 を Playwright で自動化し、`npm run test:e2e` と CI（対象のパスを変えた PR と main への push）で毎回確かめる。
- M3 以降の E2E を足せる土台（起動・ログイン・DB の初期化・二人の context）を作る。

## 要件

| ID | 要件 |
| --- | --- |
| E2E-R1 | `npm run test:e2e` 1 つで、DB（Testcontainers）・API・web の起動から試験・後片付けまで終わる。前提は Docker と Node 22 だけ |
| E2E-R2 | ルートの `npm test` と CI の quality ジョブは E2E を起動しない |
| E2E-R3 | Google を通さずにひなた・あおいでログインした状態を作る。API に試験用の経路を足さない |
| E2E-R4 | 各試験の前に業務の表を空にする。利用者・許可リスト・セッションは残す |
| E2E-R5 | 試験は 1 つずつ順番に流す（`workers: 1`） |
| E2E-R6 | 失敗時にトレースとスクリーンショットを残す（CI では artifact、7 日） |
| E2E-R7 | CI は `apps/web/**`・`apps/api/**`・`packages/contracts/**`・`e2e/**`・`package-lock.json`・`.github/workflows/e2e.yml` を変えた PR と main への push で回る。最初は必須のチェックにしない |

## 対象範囲

- 新しい workspace `e2e/`（`@tomotabi/e2e`）: Playwright の設定、起動スクリプト、共通の fixture、M-01〜M-04 の試験。
- ルートの `package.json`: workspaces に `e2e` を足し、`test:e2e` を足す。
- `.github/workflows/e2e.yml`。
- README のコマンド一覧に `npm run test:e2e` を足す。

## 対象外

- アプリ（`apps/web`・`apps/api`）のコードの変更。E2E のためにアプリへ試験用の口を足さない。
- M-05（見た目）・M-06（375 幅）の自動化。スクリーンショット比較。
- Chromium 以外のブラウザ、実機。
- E2E を CI の必須チェックにすること（2 週間の様子見のあとユーザーが決める）。

## 現状構成

- 試験: `apps/api/tests`（Vitest。`tests/db` は Testcontainers で実 PostgreSQL）、`apps/web/tests`（Vitest + Testing Library。API はモック）。
- `apps/api/tests/support/database.ts` の `startPostgres()` がコンテナの起動・ロールの作成・migration を行う。
- `apps/api/tests/db/*-http.db.test.ts` は `createAuth(..., { plugins: [testUtils()] })` と `auth.$context.test` でセッションを作る。
- API は `createAuthFromEnv()`（`DATABASE_URL`・`PUBLIC_APP_ORIGIN`・`BETTER_AUTH_SECRET`・`GOOGLE_CLIENT_ID`・`GOOGLE_CLIENT_SECRET`）。セッションの Cookie 名は `travel.session_token`。
- web は `/api/*` を `API_ORIGIN`（既定 `http://localhost:3001`）へ rewrites する。

## 変更後構成

```text
e2e/
  package.json            # @tomotabi/e2e（private）。scripts: { "e2e": "node scripts/run.mjs" }。test は置かない（E2E-R2）
  playwright.config.ts    # webServer（api・web）、workers: 1、Chromium、375x812、trace/screenshot は失敗時のみ
  scripts/run.mjs         # 起動スクリプト（下の「データフロー」1〜4）
  support/
    env.ts                # run.mjs が渡す環境変数を読む（接続先・ポート・秘密）
    db.ts                 # 業務の表を空にする（migrator）
    auth.ts               # testUtils でひなた・あおいのセッションと Cookie を作る
    fixtures.ts           # test.extend: hinataPage・aoiPage（context 2 つ）、各試験の前に db.reset()
    seed.ts               # 利用者・許可リストの投入（run.mjs から 1 回だけ）
  tests/
    m01-flow.spec.ts
    m02-two-people.spec.ts
    m03-selected-trip.spec.ts
    m04-unknown-result.spec.ts
.github/workflows/e2e.yml
```

- `e2e/` から `apps/api` の `createAuth`（`src/modules/identity/infrastructure/better-auth.ts`）と `tests/support/database.ts` を import する。`e2e/tsconfig.json` の paths か相対 import で参照し、`apps/api` 側に公開用の変更は足さない。

## データフロー

`npm run test:e2e` → `npm run e2e -w @tomotabi/e2e` → `node scripts/run.mjs`:

1. Testcontainers で PostgreSQL を起動し、`startPostgres()` と同じ手順でロールを作って migration を当てる。
2. `seed.ts` でひなた（slot 0）・あおい（slot 1）の users / accounts / allowlist を入れる（M1 の架空の値。メールは `@example.test`）。
3. 次の環境変数を決めて、`npx playwright test` を子プロセスで起動する（`stdio: inherit`）。
   - `E2E_DATABASE_URL_RUNTIME`（app_runtime）、`E2E_DATABASE_URL_MIGRATOR`（migrator）
   - `E2E_API_PORT`（例 3101）・`E2E_WEB_PORT`（例 3100）
   - `E2E_AUTH_SECRET`（実行ごとに `crypto.randomBytes(32)` で作る）
4. Playwright が終わったら（失敗・中断でも `finally` で）コンテナを止め、Playwright の終了コードで終わる。

`playwright.config.ts` の `webServer`（上の環境変数を使う）:

| 名前 | コマンド | 主な環境変数 | 待ち合わせ |
| --- | --- | --- | --- |
| api | `npm run build -w @tomotabi/api && node apps/api/dist/main` | `DATABASE_URL`=runtime、`PORT`=E2E_API_PORT、`PUBLIC_APP_ORIGIN`=`http://localhost:${E2E_WEB_PORT}`、`BETTER_AUTH_SECRET`=E2E_AUTH_SECRET、`GOOGLE_CLIENT_ID`/`SECRET`=`e2e-unused`（Google は呼ばれない） | `http://localhost:${E2E_API_PORT}/api/health` 相当（無ければ `/api/me` が 401 を返すこと） |
| web | `npm run build -w @tomotabi/web && npm run start -w @tomotabi/web -- --port ${E2E_WEB_PORT}` | `API_ORIGIN`=`http://localhost:${E2E_API_PORT}` | `http://localhost:${E2E_WEB_PORT}/sign-in` |

- `reuseExistingServer: false`（手元で起動している開発サーバーを誤って使わない）。起動の上限は 180 秒。
- build は CI では事前のステップで済ませ、`webServer` は `node` / `next start` だけにする（`E2E_SKIP_BUILD=1` で分岐）。手元では毎回 build する。

ログイン（`support/auth.ts`。global setup ではなく fixture で試験ごとに使う）:

1. `createAuth({ baseURL: web の origin, secret: E2E_AUTH_SECRET, googleClientId/Secret: "e2e-unused", useSecureCookies: false }, runtime の Pool, { plugins: [testUtils()] })`。
2. `(await auth.$context).test` の login 相当で、ひなた・あおいのセッションを作り Cookie を受け取る。
3. `context.addCookies([{ name, value, url: web の origin, httpOnly: true, sameSite: "Lax" }])`。
- セッションは表を空にしても残る（`identity.sessions` は対象外）が、M-03 でログアウトすると消えるので、fixture は試験ごとに作り直す。

## API 設計

変更なし（E2E-R3。試験用の経路を足さない）。

## DB 設計

変更なし。試験の準備だけで次を行う（migrator で。アプリの app_runtime には権限を足さない）:

```sql
TRUNCATE planning.plans, planning.trip_participants, planning.trips,
         record.active_plan_events, record.plan_event_cancellations, record.plan_events,
         infra.command_receipts, infra.trip_finance_guards
RESTART IDENTITY CASCADE;
```

- `record.*` の追記のみの保証（migration 0003）は `BEFORE UPDATE OR DELETE` の行トリガーなので TRUNCATE では動かない（ADR-0005 で確認）。実装の最初にこの文が通ることを確かめ、通らなければ止まって報告する。

## フロントエンド設計

変更なし。試験は次のように画面を操作する。

- 要素は役割と名前（`getByRole`・`getByLabel`）で探す。CSS のクラスや内部の id に依存しない。種類の選択肢・「時刻未定」は #91 で読み上げ名が直る前提。#91 がマージされる前に書く場合は、その 2 か所だけ `getByText` で探し、#91 のあとで役割に直す。
- 375×812 のモバイルの模擬（`isMobile: true`・`hasTouch: true`）。クリックは Playwright の `tap` ではなく `click` を使う（Playwright はモバイルの模擬でも `click` を届ける）。

## バックエンド設計

変更なし。

## エラー処理

- 起動スクリプト: コンテナの起動に失敗したら「Docker が要る」と出して終了コード 1。PGlite などへ代えない（既存の方針）。Playwright が異常終了しても `finally` でコンテナを止める。
- M-04 の結果不明は `page.route` で作る（ADR-0005 Decision 3）: 予定の追加の POST だけを `route.fetch()` で API に届けてから `route.abort("failed")`。そのあと `page.unroute` して「同じ内容で確認する」。

外部 I/O の 5 項目（Testcontainers・ブラウザ）:

- (a) リトライ: 試験の自動リトライは CI で 1 回だけ（`retries: process.env.CI ? 1 : 0`）。1 回目で落ちて 2 回目で通った試験は、レポートに flaky として残し、ログで追う
- (b) タイムアウト: 試験 60 秒、`expect` 10 秒、`webServer` 180 秒
- (c) 冪等性: 各試験の前に表を空にするので、試験の順番や再実行に依存しない
- (d) 部分失敗: 起動スクリプトが途中で落ちても、コンテナは `finally` と Testcontainers の後片付け（Ryuk）で止まる
- (e) フォールバック: 対象外（Docker が無い環境では実行しない）

## ログと監視

- CI の失敗時に `e2e/playwright-report/` と `e2e/test-results/`（トレース・スクリーンショット）を artifact に 7 日残す。
- API の標準出力は `webServer` の `stdout: "pipe"` でレポートに残す。秘密（`E2E_AUTH_SECRET`）は出さない。

## セキュリティ

- 秘密は実行ごとに作る乱数で、ファイルにもログにも残さない。Google の資格情報はダミー（`e2e-unused`）で、Google は呼ばれない。
- testUtils はテストのプロセス（Playwright 側）でだけ使う。`apps/api/src/**` から `better-auth/plugins` を import できない ESLint の規則はそのまま。
- CI の `e2e.yml` は `permissions: contents: read`。フォークからの PR でも秘密を使わない（使う秘密が無い）。

## 性能

- 見込み: build 2 分、コンテナと migration 30 秒、試験 4 本で 1〜2 分。CI の 1 回あたり 5 分以内を目安にする。超えたら build のキャッシュ（`actions/setup-node` の npm キャッシュと `.next/cache`）を足す。

## テスト方針

- 試験そのものが成果物。各試験は「確かめたい振る舞いを壊したら落ちる」ことを、実装の PR の説明に書く（例: M-04 で `route.abort` を外すと「結果不明」が出ず落ちる、M-02 で If-Match を付けないと 428 になり C-5 が出ず落ちる、を一時的に試す）。
- 手元と CI で、E2E を 5 回続けて流して不安定にならないことを PR の説明に書く。
- ハーネスのテスト（`npm run test:harness`）と既存の `npm test` が E2E を起動しないことを確かめる（E2E-R2）。

## 移行とリリース

対象外（新しく足すだけ）。`e2e.yml` は最初は必須のチェックにしない。

## リスク

| リスク | 対策 |
| --- | --- |
| next build と nest build で CI が遅くなる | 対象のパスを変えた PR だけで回す。遅ければキャッシュを足す |
| `e2e/` が API の内部（`createAuth`・`tests/support`）に依存し、API の変更で E2E が壊れる | import する場所を `support/auth.ts`・`support/db.ts` の 2 つに閉じる |
| 画面の文言や構造の変更（#91・#92）で試験が壊れる | 役割と名前で探す。#91・#92 のマージ後に書くか、マージ後に直す |
| 試験の不安定（待ち合わせ） | 固定の待ち時間を使わず、`expect(...).toBeVisible()` などの自動待ちだけを使う |

## 未決事項

1. 実装の分け方: 1 つの PR（土台 + M-01〜M-04 + CI）にするか、2 つ（土台 + M-01 → M-02〜M-04 + CI）にするか。**推奨: 2 つ**。土台の不安定さを M-01 だけで先に潰し、レビューを小さくする。
2. #91・#92（見た目の直し）との順番。**推奨: #91 のマージ後に E2E の PR を出す**（読み上げ名が直ってから役割で探す）。E2E の実装は並行で始めてよい。
