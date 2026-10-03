# ADR-0005: E2Eテスト（Playwright）の構成

- Status: Accepted（2026-10-01ユーザー承認。1〜4は推奨案）
- Date: 2026-09-30
- 関連feature: e2e-foundation（M3の前に入れる）

## Context（背景・なぜ判断が必要か）

M2までの試験は、Domain・UseCaseの単体、HTTP + 実PostgreSQL（Testcontainers）、webの画面単体（Vitest + Testing Library）と手動確認（M-01〜M-06）だった。M2-eで次のことが分かった。

- 手動確認のM-02（二人での競合）は、2人目のGoogleアカウントが用意できず、同じアカウントのタブ2つで代わりに確かめた。M-04（保存の直前にAPIが止まる）はスキップした（`logs/2026-09-30.md`）。
- webの画面テストはAPIをモックするため、webとAPIをつないだときの振る舞い（Cookie、rewrites、ETag、再送）は手動でしか確かめていない。
- M3では、保存の結果が分からなくなったときにIndexedDBから同じ要求で確かめる仕組みを作る。これは実際のブラウザでないと確かめにくい。

2026-09-28にユーザーが決めたこと（M2の間はE2Eを作らず、M2-eの後・M3の前に入れる）:

1. 手段は **Playwright**。
2. 最初の対象は **M-01〜M-04だけ**。M-05（見た目）とM-06（375幅）は手動のまま。
3. CIは **`apps/web`・`apps/api`・`packages/contracts`を変えたPRと、mainへのpush** で回す。GitHubホストのランナーで、DBは既存のapi-dbジョブと同じくTestcontainers。
4. ログインは **テスト用の仕組み（better-authのtestUtils）** を使い、Googleを通さない。当初の案は「`apps/api/e2e/`の専用起動口 + testUtils」。
5. 二人は **ブラウザのcontextを2つ**。
6. DBは **業務の表だけを試験ごとに空にし**、試験は **1つずつ順番に**流す。

このADRは1〜6を記録し、まだ決めていない細部（置き場所、ログインの受け渡し、結果不明の作り方、起動のしかた、CIの書き方）を決める。

## Decision（採用した決定）

### 1. 置き場所: ルートの`e2e/`をnpm workspaceにする

- `e2e/`に`@tomotabi/e2e`（private）を作り、`@playwright/test`はここのdevDependenciesにだけ入れる。
- web・APIのどちらにも属さない（両方を起動して、その間を確かめる）ため、どちらかのappの中に置かない。
- `npm run test:e2e`（ルート）→ `npm run e2e -w @tomotabi/e2e`。e2eのworkspaceには **`test`という名前のスクリプトを置かない**。ルートの`npm test`は`--workspaces --if-present`で全workspaceの`test`を呼ぶため、`test`を置くと通常のテストとCIのqualityジョブがE2E（Dockerとビルドが要り、遅い）まで起動してしまう（PR #94のDevin Reviewの指摘）。

### 2. ログインの受け渡し: Playwright側でtestUtilsを使ってCookieを作る。APIに試験用の経路を足さない

- Playwrightのglobal setupが、APIと同じ`BETTER_AUTH_SECRET`と同じDBを使って`createAuth(..., { plugins: [testUtils()] })`を作り、`test.login`相当でひなた・あおいのセッションを作る。返ったCookieを`context.addCookies`で2つのcontextに入れる。
- APIは本番と同じ`main.ts`（`createAuthFromEnv`）をビルドして起動する。**試験用のログインの経路は、どのプロセスのHTTPにも載らない**。
- `better-auth/plugins`は今どおり`apps/api/src/**`からimportできない（ESLintで塞いである）。`e2e/`から`apps/api`の`createAuth`をimportする形になる。

2026-09-28の案（`apps/api/e2e/`に専用の起動口を置き、そこにtestUtilsと試験用のログインの経路を足す）からの変更点。理由はAlternativesの表。

### 3. 結果不明（M-04）の作り方: `page.route`で要求をサーバーに通し、応答だけ捨てる

- `page.route`の中で`route.fetch()`でAPIに届けてから`route.abort("failed")`にする。サーバーでは保存が成立し、ブラウザにはnetwork失敗に見える。これはE-21（応答が失われた保存）そのもの。
- そのあと`page.unroute`して「同じ内容で確認する」を押し、予定が1件だけであることを確かめる。
- APIのプロセスを止める方法は、止めた時点で要求が届いたかが決まらず、試験が不安定になるので使わない。

### 4. 起動のしかた

- **起動の順番が決まっているので、Playwrightの前に動く起動スクリプト（`e2e/scripts/run.mjs`）で準備する。** Playwrightは`webServer`をglobal setupより先に起動するため、global setupでDBを作ると、APIの起動時に`DATABASE_URL`がまだ決まっていない（PR #94のDevin Reviewの指摘）。
  1. TestcontainersのPostgreSQLを起動し、既存の`apps/api/tests/support/database.ts`と同じ手順でロールを作ってmigrationを当てる。ひなた・あおいのusers / accounts / allowlistを1回だけ入れる。
  2. 決まった接続先（app_runtimeとmigratorのURL）と、試験用の`BETTER_AUTH_SECRET`などを環境変数に入れて、`playwright test`を子プロセスで起動する。
  3. Playwrightの`webServer`が、その環境変数でAPIとwebを起動する。
     - API: `npm run build -w @tomotabi/api`の成果物を`node apps/api/dist/main`で起動（`PORT`は固定の試験用ポート）。
     - web: `next build`のあと`next start`（`API_ORIGIN`を上のAPIに向ける）。開発サーバーは初回の組み立てで数秒待つため使わない（M2-eで実際に遅れた）。
  4. Playwrightが終わったら（失敗しても）コンテナを止める。終了コードはPlaywrightのものを返す。
- global setupは、上で決まったDBに対してセッションを作る（Decision 2）ことだけを行う。
- ブラウザは **Chromiumだけ**、viewportは **375×812**（v3の基準）。

### 5. 試験ごとのDBの初期化

- 各試験の前に、migratorで業務の表（`planning.*`・`record.*`・`infra.command_receipts`・`infra.trip_finance_guards`）を`TRUNCATE ... RESTART IDENTITY CASCADE`する。`identity.*`（利用者・許可リスト）とセッションは残す。
- `workers: 1`、`fullyParallel: false`（試験を1つずつ順番に流す）。
- `record.*`の追記のみの保証（migration 0003）は`BEFORE UPDATE OR DELETE`の行トリガーなので、TRUNCATEでは動かない（SQLを読んで確認済み）。最初のスパイクで実際に空にできることを確かめる。できない場合は、試験ファイルごとにDBを`CREATE DATABASE ... TEMPLATE`で作り直す方式に切り替え、このADRに追記する。
- このTRUNCATEは試験の準備だけで、migratorで行う。アプリ（app_runtime）にはTRUNCATEの権限を与えない。

### 6. CI: 別のワークフロー`e2e.yml`に分ける

- `on.pull_request.paths`と`on.push`（main）で、`apps/web/**`・`apps/api/**`・`packages/contracts/**`・`e2e/**`・`package-lock.json`を変えたときだけ回す。
- 失敗したときはPlaywrightのトレースとスクリーンショットをartifactに残す（保存期間7日）。
- 最初は必須のチェックにしない。2週間ほど不安定にならないことを見てから、必須にするかをユーザーが決める。

### 7. 最初に書く試験（M-01〜M-04）

| 試験 | 中身 |
| --- | --- |
| M-01 | ひなたで旅行を作る → 予定3件（時刻未定を含む）→ 編集・日の移動・取りやめ → 開始 → 終了 → 終了後の追加 |
| M-02 | ひなた・あおいの2つのcontextで同じ旅行を開く。ひなたが名前を変えたあと、あおいが古い画面から変える → C-5。「あなたの入力で保存」まで |
| M-03 | ログアウト → ログインで旅行一覧。旅行を選んでから`/`を開き直すとそのしおり |
| M-04 | 予定の追加の応答を捨てる → C-4 → 「同じ内容で確認する」→ 予定は1件だけ |

M-03の「ログイン」はGoogleを通さず、global setupで作り直したセッションのCookieを入れ直して代える。

## Alternatives（検討した別案と不採用の理由）

| 論点 | 別案 | 不採用の理由 |
| --- | --- | --- |
| 手段 | Cypress | 複数のcontext（二人）を1つの試験で扱いにくい。2026-09-28にユーザーがPlaywrightに決めた |
| 置き場所 | `apps/web/e2e/` | webの依存にPlaywrightとAPIの起動の知識が入る。webの単体テストの設定（Vitest）と混ざる |
| 置き場所 | `apps/e2e/` | `apps/`はデプロイするappの置き場所なので、試験だけのworkspaceを並べると紛らわしい |
| ログイン | `apps/api/e2e/`の専用起動口にtestUtilsと試験用のログインの経路を足す（2026-09-28の案） | 本番と違う起動口でアプリを組むことになり、E2Eで確かめたい「本番と同じ組み立て」から離れる（#35・#39で踏んだ種類の違い）。試験用のログインの経路がHTTPに載るため、本番の起動口に紛れ込まないことを別に守る必要がある |
| ログイン | GoogleのOAuthをテスト用アカウントで通す | 実アカウントのパスワードや2段階認証をCIに置くことになる。Google側の画面の変化で試験が壊れる |
| ログイン | セッションの行をSQLで直接入れ、Cookieを自前で署名する | better-authのCookieの形式・署名に試験が依存し、better-authの更新で壊れる。testUtilsはその形式をbetter-auth自身が作る |
| 結果不明 | APIのプロセスを止める | 止めた時点で要求が届いたかが決まらず不安定。止めて戻すのに時間がかかる |
| 起動 | `next dev`と`nest start --watch` | 初回の組み立てで数秒待つ（M2-eで遅れた）。本番のビルドと違う |
| DBの初期化 | 試験ごとにコンテナを作り直す | 1回に数秒かかり、M-01〜04だけでも遅くなる |
| 起動 | Playwrightのglobal setupでDBを起動する | `webServer`はglobal setupより先に起動するので、APIに`DATABASE_URL`を渡せない |
| 起動 | global setupでDB・API・webをすべて自前で起動し、teardownで止める | `webServer`の待ち合わせ（ポートが開くまで待つ・ログを出す）を自作することになる。起動スクリプトでDBだけ先に作れば`webServer`をそのまま使える |
| CI | 既存の`ci.yml`にジョブを足す | ワークフロー全体の`on`にpathsを付けられないため、ジョブの中で変更の有無を判定する仕組み（外部のaction）が要る。別のワークフローなら`on.paths`で足りる |

## Consequences（良い影響・悪い影響・残るリスク）

- 良い: webとAPIをつないだときの振る舞い（Cookie、rewrites、ETag、同じ要求での確認）を毎回確かめられる。M-02・M-04の手動確認の穴が埋まる。M3のIndexedDBによる復帰を試験できる土台になる。
- 悪い: CIの時間が増える（見込み: ビルド2分 + Testcontainers 30秒 + 試験1〜2分）。`paths`で対象のPRに絞る。
- 悪い: `e2e/`が`apps/api`の内部（`createAuth`・`tests/support/database.ts`）をimportする。APIのこれらの形を変えるとE2Eも直す必要がある。
- 残るリスク: TRUNCATEと追記のみの保証（migration 0003）の相性。SQLの上では問題ないが、最初のスパイクで実際に確かめる（Decision 5）。
- 残るリスク: M-05（見た目）とM-06（375幅）は手動のまま。スクリーンショット比較は入れない（見た目の判断は人が行うため）。

## Migration（移行が必要な場合の手順）

対象外（新しく足すだけ。既存の試験・CIは変えない）。

## Rollback（決定を戻す場合の手順）

`e2e/`のworkspaceと`e2e.yml`を消し、ルートの`package.json`の`test:e2e`とworkspacesの1行を戻す。アプリのコードには試験用の変更を入れないので、戻すのはこれだけ。

## References（設計書・要件・関連ADR・外部資料へのリンク）

- `logs/2026-09-30.md`（M2-eの結果。M-02の代わりの確かめ方、M-04のスキップ）
- `docs/tests/m2-trips-and-plans.md`のM-01〜M-04、E-21
- ADR-0002（M1の認証。better-auth）、ADR-0003（DBのロールとmigration）、ADR-0004（webの取得状態）
- `apps/api/tests/db/auth-http.db.test.ts`・`plans-http.db.test.ts`（testUtilsでセッションを作る既存の形）、`apps/api/tests/support/database.ts`
- `.github/workflows/ci.yml`（既存のapi-dbジョブ）
