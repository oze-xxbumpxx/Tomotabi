# 設計書: e2e-foundation

- ステータス: draft
- レベル: L2（新しいworkspace・CIのワークフロー。アプリのコードは変えない）
- 関連: ADR-0005（E2Eテスト（Playwright）の構成。2026-10-01 Accepted）、docs/tests/m2-trips-and-plans.mdのM-01〜M-04、logs/2026-09-30.md（M2-e）

## 背景

M2-eの手動確認で、M-02（二人での競合）は2人目のアカウントが無く同じアカウントのタブ2つで代わりに確かめ、M-04（結果不明）はスキップした。webとAPIをつないだ振る舞い（Cookie、rewrites、ETag、同じ要求での確認）は手動でしか確かめていない。M3のIndexedDBによる復帰は実ブラウザでしか確かめにくい。ADR-0005で構成を決めた。この設計書は、ADRの決定を実装できる粒度に落とす。

## 目的

- M-01〜M-04をPlaywrightで自動化し、`npm run test:e2e`とCI（対象のパスを変えたPRとmainへのpush）で毎回確かめる。
- M3以降のE2Eを足せる土台（起動・ログイン・DBの初期化・二人のcontext）を作る。

## 要件

| ID | 要件 |
| --- | --- |
| E2E-R1 | `npm run test:e2e` 1つで、DB（Testcontainers）・API・webの起動から試験・後片付けまで終わる。前提はDockerとNode 22だけ |
| E2E-R2 | ルートの`npm test`とCIのqualityジョブはE2Eを起動しない |
| E2E-R3 | Googleを通さずにひなた・あおいでログインした状態を作る。APIに試験用の経路を足さない |
| E2E-R4 | 各試験の前に業務の表を空にする。利用者・許可リスト・セッションは残す |
| E2E-R5 | 試験は1つずつ順番に流す（`workers: 1`） |
| E2E-R6 | 失敗時にトレースとスクリーンショットを残す（CIではartifact、7日） |
| E2E-R7 | CIは`apps/web/**`・`apps/api/**`・`packages/contracts/**`・`e2e/**`・`package-lock.json`・`.github/workflows/e2e.yml`を変えたPRとmainへのpushで回る。最初は必須のチェックにしない |

## 対象範囲

- 新しいworkspace `e2e/`（`@tomotabi/e2e`）: Playwrightの設定、起動スクリプト、共通のfixture、M-01〜M-04の試験。
- ルートの`package.json`: workspacesに`e2e`を足し、`test:e2e`を足す。
- `.github/workflows/e2e.yml`。
- READMEのコマンド一覧に`npm run test:e2e`を足す。

## 対象外

- アプリ（`apps/web`・`apps/api`）のコードの変更。E2Eのためにアプリへ試験用の口を足さない。
- M-05（見た目）・M-06（375幅）の自動化。スクリーンショット比較。
- Chromium以外のブラウザ、実機。
- E2EをCIの必須チェックにすること（2週間の様子見のあとユーザーが決める）。

## 現状構成

- 試験: `apps/api/tests`（Vitest。`tests/db`はTestcontainersで実PostgreSQL）、`apps/web/tests`（Vitest + Testing Library。APIはモック）。
- `apps/api/tests/support/database.ts`の`startPostgres()`がコンテナの起動・ロールの作成・migrationを行う。
- `apps/api/tests/db/*-http.db.test.ts`は`createAuth(..., { plugins: [testUtils()] })`と`auth.$context.test`でセッションを作る。
- APIは`createAuthFromEnv()`（`DATABASE_URL`・`PUBLIC_APP_ORIGIN`・`BETTER_AUTH_SECRET`・`GOOGLE_CLIENT_ID`・`GOOGLE_CLIENT_SECRET`）。セッションのCookie名は`travel.session_token`。
- webは`/api/*`を`API_ORIGIN`（既定`http://localhost:3001`）へrewritesする。

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

- `e2e/`から`apps/api`の`createAuth`（`src/modules/identity/infrastructure/better-auth.ts`）と`tests/support/database.ts`をimportする。`e2e/tsconfig.json`のpathsか相対importで参照し、`apps/api`側に公開用の変更は足さない。

## データフロー

`npm run test:e2e` → `npm run e2e -w @tomotabi/e2e` → `node scripts/run.mjs`:

1. TestcontainersでPostgreSQLを起動し、`startPostgres()`と同じ手順でロールを作ってmigrationを当てる。
2. `seed.ts`でひなた（slot 0）・あおい（slot 1）のusers / accounts / allowlistを入れる（M1の架空の値。メールは`@example.test`）。
3. 次の環境変数を決めて、`npx playwright test`を子プロセスで起動する（`stdio: inherit`）。
   - `E2E_DATABASE_URL_RUNTIME`（app_runtime）、`E2E_DATABASE_URL_MIGRATOR`（migrator）
   - `E2E_API_PORT`（3101固定）・`E2E_WEB_PORT`（3100固定。webのbuildに焼き込まれるため、実行ごとに変えない）
   - `E2E_AUTH_SECRET`（実行ごとに`crypto.randomBytes(32)`で作る）
4. Playwrightが終わったら（失敗・中断でも`finally`で）コンテナを止め、Playwrightの終了コードで終わる。

`playwright.config.ts`の`webServer`（上の環境変数を使う）:

| 名前 | コマンド | 主な環境変数 | 待ち合わせ |
| --- | --- | --- | --- |
| api | `npm run build -w @tomotabi/api && node apps/api/dist/main` | `DATABASE_URL`=runtime、`PORT`=E2E_API_PORT、`PUBLIC_APP_ORIGIN`=`http://localhost:${E2E_WEB_PORT}`、`BETTER_AUTH_SECRET`=E2E_AUTH_SECRET、`GOOGLE_CLIENT_ID`/`SECRET`=`e2e-unused`（Googleは呼ばれない） | `http://localhost:${E2E_API_PORT}/api/health`相当（無ければ`/api/me`が401を返すこと） |
| web | `npm run build -w @tomotabi/web && npm run start -w @tomotabi/web -- --port ${E2E_WEB_PORT}` | `API_ORIGIN`=`http://localhost:${E2E_API_PORT}` | `http://localhost:${E2E_WEB_PORT}/sign-in` |

- `reuseExistingServer: false`（手元で起動している開発サーバーを誤って使わない）。起動の上限は180秒。
- buildはCIでは事前のステップで済ませ、`webServer`は`node` / `next start`だけにする（`E2E_SKIP_BUILD=1`で分岐）。手元では毎回buildする。
- **webのbuildには必ず`API_ORIGIN=http://localhost:${E2E_API_PORT}`を渡す。** Next.jsの`rewrites`の転送先は`next build`のときに決まり、`next start`の環境変数では変わらない。渡さないと既定の3001番に固まり、E2EのAPIに要求が届かない（PR #97のDevin Review）。そのためE2Eのポートは固定値（API 3101・web 3100）にし、`e2e/support/env.ts`の定数をCIのbuildのステップでも同じ値で使う。

ログイン（`support/auth.ts`。global setupではなくfixtureで試験ごとに使う）:

1. `createAuth({ baseURL: web の origin, secret: E2E_AUTH_SECRET, googleClientId/Secret: "e2e-unused", useSecureCookies: false }, runtime の Pool, { plugins: [testUtils()] })`。
2. `(await auth.$context).test`のlogin相当で、ひなた・あおいのセッションを作りCookieを受け取る。
3. `context.addCookies([{ name, value, url: web の origin, httpOnly: true, sameSite: "Lax" }])`。
- セッションは表を空にしても残る（`identity.sessions`は対象外）が、M-03でログアウトすると消えるので、fixtureは試験ごとに作り直す。

## API設計

変更なし（E2E-R3。試験用の経路を足さない）。

## DB設計

変更なし。試験の準備だけで次を行う（migratorで。アプリのapp_runtimeには権限を足さない）:

```sql
TRUNCATE planning.plans, planning.trip_participants, planning.trips,
         record.active_plan_events, record.plan_event_cancellations, record.plan_events,
         infra.command_receipts, infra.trip_finance_guards
RESTART IDENTITY CASCADE;
```

- `record.*`の追記のみの保証（migration 0003）は`BEFORE UPDATE OR DELETE`の行トリガーなのでTRUNCATEでは動かない（ADR-0005で確認）。実装の最初にこの文が通ることを確かめ、通らなければ止まって報告する。

## フロントエンド設計

変更なし。試験は次のように画面を操作する。

- 要素は役割と名前（`getByRole`・`getByLabel`）で探す。CSSのクラスや内部のidに依存しない。種類の選択肢・「時刻未定」は #91で読み上げ名が直る前提。#91がマージされる前に書く場合は、その2か所だけ`getByText`で探し、#91のあとで役割に直す。
- 375×812のモバイルの模擬（`isMobile: true`・`hasTouch: true`）。クリックはPlaywrightの`tap`ではなく`click`を使う（Playwrightはモバイルの模擬でも`click`を届ける）。

## バックエンド設計

変更なし。

## エラー処理

- 起動スクリプト: コンテナの起動に失敗したら「Dockerが要る」と出して終了コード1。PGliteなどへ代えない（既存の方針）。Playwrightが異常終了しても`finally`でコンテナを止める。
- M-04の結果不明は`page.route`で作る（ADR-0005 Decision 3）: 予定の追加のPOSTだけを`route.fetch()`でAPIに届けてから`route.abort("failed")`。そのあと`page.unroute`して「同じ内容で確認する」。

外部I/Oの5項目（Testcontainers・ブラウザ）:

- (a)リトライ: 試験の自動リトライはCIで1回だけ（`retries: process.env.CI ? 1 : 0`）。1回目で落ちて2回目で通った試験は、レポートにflakyとして残し、ログで追う
- (b)タイムアウト: 試験60秒、`expect` 10秒、`webServer` 180秒
- (c)冪等性: 各試験の前に表を空にするので、試験の順番や再実行に依存しない
- (d)部分失敗: 起動スクリプトが途中で落ちても、コンテナは`finally`とTestcontainersの後片付け（Ryuk）で止まる
- (e)フォールバック: 対象外（Dockerが無い環境では実行しない）

## ログと監視

- CIの失敗時に`e2e/playwright-report/`と`e2e/test-results/`（トレース・スクリーンショット）をartifactに7日残す。
- APIの標準出力は`webServer`の`stdout: "pipe"`でレポートに残す。秘密（`E2E_AUTH_SECRET`）は出さない。

## セキュリティ

- 秘密は実行ごとに作る乱数で、ファイルにもログにも残さない。Googleの資格情報はダミー（`e2e-unused`）で、Googleは呼ばれない。
- testUtilsはテストのプロセス（Playwright側）でだけ使う。`apps/api/src/**`から`better-auth/plugins`をimportできないESLintの規則はそのまま。
- CIの`e2e.yml`は`permissions: contents: read`。フォークからのPRでも秘密を使わない（使う秘密が無い）。

## 性能

- 見込み: build 2分、コンテナとmigration 30秒、試験4本で1〜2分。CIの1回あたり5分以内を目安にする。超えたらbuildのキャッシュ（`actions/setup-node`のnpmキャッシュと`.next/cache`）を足す。

## テスト方針

- 試験そのものが成果物。各試験は「確かめたい振る舞いを壊したら落ちる」ことを、実装のPRの説明に書く（例: M-04で`route.abort`を外すと「結果不明」が出ず落ちる、M-02でIf-Matchを付けないと428になりC-5が出ず落ちる、を一時的に試す）。
- 手元とCIで、E2Eを5回続けて流して不安定にならないことをPRの説明に書く。
- ハーネスのテスト（`npm run test:harness`）と既存の`npm test`がE2Eを起動しないことを確かめる（E2E-R2）。

## 移行とリリース

対象外（新しく足すだけ）。`e2e.yml`は最初は必須のチェックにしない。

## リスク

| リスク | 対策 |
| --- | --- |
| next buildとnest buildでCIが遅くなる | 対象のパスを変えたPRだけで回す。遅ければキャッシュを足す |
| `e2e/`がAPIの内部（`createAuth`・`tests/support`）に依存し、APIの変更でE2Eが壊れる | importする場所を`support/auth.ts`・`support/db.ts`の2つに閉じる |
| 画面の文言や構造の変更（#91・#92）で試験が壊れる | 役割と名前で探す。#91・#92のマージ後に書くか、マージ後に直す |
| 試験の不安定（待ち合わせ） | 固定の待ち時間を使わず、`expect(...).toBeVisible()`などの自動待ちだけを使う |

## 未決事項

1. 実装の分け方: 1つのPR（土台 + M-01〜M-04 + CI）にするか、2つ（土台 + M-01 → M-02〜M-04 + CI）にするか。**推奨: 2つ**。土台の不安定さをM-01だけで先に潰し、レビューを小さくする。
2. #91・#92（見た目の直し）との順番。**推奨: #91のマージ後にE2EのPRを出す**（読み上げ名が直ってから役割で探す）。E2Eの実装は並行で始めてよい。
