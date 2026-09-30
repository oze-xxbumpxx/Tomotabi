# ADR-0005: E2E テスト（Playwright）の構成

- Status: Proposed
- Date: 2026-09-30
- 関連 feature: e2e-foundation（M3 の前に入れる）

## Context（背景・なぜ判断が必要か）

M2 までの試験は、Domain・UseCase の単体、HTTP + 実 PostgreSQL（Testcontainers）、web の画面単体（Vitest + Testing Library）と手動確認（M-01〜M-06）だった。M2-e で次のことが分かった。

- 手動確認の M-02（二人での競合）は、2 人目の Google アカウントが用意できず、同じアカウントのタブ 2 つで代わりに確かめた。M-04（保存の直前に API が止まる）はスキップした（`logs/2026-09-30.md`）。
- web の画面テストは API をモックするため、web と API をつないだときの振る舞い（Cookie、rewrites、ETag、再送）は手動でしか確かめていない。
- M3 では、保存の結果が分からなくなったときに IndexedDB から同じ要求で確かめる仕組みを作る。これは実際のブラウザでないと確かめにくい。

2026-09-28 にユーザーが決めたこと（M2 の間は E2E を作らず、M2-e の後・M3 の前に入れる）:

1. 手段は **Playwright**。
2. 最初の対象は **M-01〜M-04 だけ**。M-05（見た目）と M-06（375 幅）は手動のまま。
3. CI は **`apps/web`・`apps/api`・`packages/contracts` を変えた PR と、main への push** で回す。GitHub ホストのランナーで、DB は既存の api-db ジョブと同じく Testcontainers。
4. ログインは **テスト用の仕組み（better-auth の testUtils）** を使い、Google を通さない。当初の案は「`apps/api/e2e/` の専用起動口 + testUtils」。
5. 二人は **ブラウザの context を 2 つ**。
6. DB は **業務の表だけを試験ごとに空にし**、試験は **1 つずつ順番に**流す。

この ADR は 1〜6 を記録し、まだ決めていない細部（置き場所、ログインの受け渡し、結果不明の作り方、起動のしかた、CI の書き方）を決める。

## Decision（採用する決定。【】は決めてほしい点で、推奨を先に書く）

### 1. 置き場所【推奨: ルートの `e2e/` を npm workspace にする】

- `e2e/` に `@tomotabi/e2e`（private）を作り、`@playwright/test` はここの devDependencies にだけ入れる。
- web・API のどちらにも属さない（両方を起動して、その間を確かめる）ため、どちらかの app の中に置かない。
- `npm run test:e2e`（ルート）→ `npm run e2e -w @tomotabi/e2e`。e2e の workspace には **`test` という名前のスクリプトを置かない**。ルートの `npm test` は `--workspaces --if-present` で全 workspace の `test` を呼ぶため、`test` を置くと通常のテストと CI の quality ジョブが E2E（Docker とビルドが要り、遅い）まで起動してしまう（PR #94 の Devin Review の指摘）。

### 2. ログインの受け渡し【推奨: Playwright 側で testUtils を使って Cookie を作る。API に試験用の経路を足さない】

- Playwright の global setup が、API と同じ `BETTER_AUTH_SECRET` と同じ DB を使って `createAuth(..., { plugins: [testUtils()] })` を作り、`test.login` 相当でひなた・あおいのセッションを作る。返った Cookie を `context.addCookies` で 2 つの context に入れる。
- API は本番と同じ `main.ts`（`createAuthFromEnv`）をビルドして起動する。**試験用のログインの経路は、どのプロセスの HTTP にも載らない**。
- `better-auth/plugins` は今どおり `apps/api/src/**` から import できない（ESLint で塞いである）。`e2e/` から `apps/api` の `createAuth` を import する形になる。

2026-09-28 の案（`apps/api/e2e/` に専用の起動口を置き、そこに testUtils と試験用のログインの経路を足す）からの変更点。理由は Alternatives の表。

### 3. 結果不明（M-04）の作り方【推奨: `page.route` で要求をサーバーに通し、応答だけ捨てる】

- `page.route` の中で `route.fetch()` で API に届けてから `route.abort("failed")` にする。サーバーでは保存が成立し、ブラウザには network 失敗に見える。これは E-21（応答が失われた保存）そのもの。
- そのあと `page.unroute` して「同じ内容で確認する」を押し、予定が 1 件だけであることを確かめる。
- API のプロセスを止める方法は、止めた時点で要求が届いたかが決まらず、試験が不安定になるので使わない。

### 4. 起動のしかた

- **起動の順番が決まっているので、Playwright の前に動く起動スクリプト（`e2e/scripts/run.mjs`）で準備する。** Playwright は `webServer` を global setup より先に起動するため、global setup で DB を作ると、API の起動時に `DATABASE_URL` がまだ決まっていない（PR #94 の Devin Review の指摘）。
  1. Testcontainers の PostgreSQL を起動し、既存の `apps/api/tests/support/database.ts` と同じ手順でロールを作って migration を当てる。ひなた・あおいの users / accounts / allowlist を 1 回だけ入れる。
  2. 決まった接続先（app_runtime と migrator の URL）と、試験用の `BETTER_AUTH_SECRET` などを環境変数に入れて、`playwright test` を子プロセスで起動する。
  3. Playwright の `webServer` が、その環境変数で API と web を起動する。
     - API: `npm run build -w @tomotabi/api` の成果物を `node apps/api/dist/main` で起動（`PORT` は固定の試験用ポート）。
     - web: `next build` のあと `next start`（`API_ORIGIN` を上の API に向ける）。開発サーバーは初回の組み立てで数秒待つため使わない（M2-e で実際に遅れた）。
  4. Playwright が終わったら（失敗しても）コンテナを止める。終了コードは Playwright のものを返す。
- global setup は、上で決まった DB に対してセッションを作る（Decision 2）ことだけを行う。
- ブラウザは **Chromium だけ**、viewport は **375×812**（v3 の基準）。

### 5. 試験ごとの DB の初期化

- 各試験の前に、migrator で業務の表（`planning.*`・`record.*`・`infra.command_receipts`・`infra.trip_finance_guards`）を `TRUNCATE ... RESTART IDENTITY CASCADE` する。`identity.*`（利用者・許可リスト）とセッションは残す。
- `workers: 1`、`fullyParallel: false`（試験を 1 つずつ順番に流す）。
- `record.*` の追記のみの保証（migration 0003）は `BEFORE UPDATE OR DELETE` の行トリガーなので、TRUNCATE では動かない（SQL を読んで確認済み）。最初のスパイクで実際に空にできることを確かめる。できない場合は、試験ファイルごとに DB を `CREATE DATABASE ... TEMPLATE` で作り直す方式に切り替え、この ADR に追記する。
- この TRUNCATE は試験の準備だけで、migrator で行う。アプリ（app_runtime）には TRUNCATE の権限を与えない。

### 6. CI【推奨: 別のワークフロー `e2e.yml` に分ける】

- `on.pull_request.paths` と `on.push`（main）で、`apps/web/**`・`apps/api/**`・`packages/contracts/**`・`e2e/**`・`package-lock.json` を変えたときだけ回す。
- 失敗したときは Playwright のトレースとスクリーンショットを artifact に残す（保存期間 7 日）。
- 最初は必須のチェックにしない。2 週間ほど不安定にならないことを見てから、必須にするかをユーザーが決める。

### 7. 最初に書く試験（M-01〜M-04）

| 試験 | 中身 |
| --- | --- |
| M-01 | ひなたで旅行を作る → 予定 3 件（時刻未定を含む）→ 編集・日の移動・取りやめ → 開始 → 終了 → 終了後の追加 |
| M-02 | ひなた・あおいの 2 つの context で同じ旅行を開く。ひなたが名前を変えたあと、あおいが古い画面から変える → C-5。「あなたの入力で保存」まで |
| M-03 | ログアウト → ログインで旅行一覧。旅行を選んでから `/` を開き直すとそのしおり |
| M-04 | 予定の追加の応答を捨てる → C-4 → 「同じ内容で確認する」→ 予定は 1 件だけ |

M-03 の「ログイン」は Google を通さず、global setup で作り直したセッションの Cookie を入れ直して代える。

## Alternatives（検討した別案と不採用の理由）

| 論点 | 別案 | 不採用の理由 |
| --- | --- | --- |
| 手段 | Cypress | 複数の context（二人）を 1 つの試験で扱いにくい。2026-09-28 にユーザーが Playwright に決めた |
| 置き場所 | `apps/web/e2e/` | web の依存に Playwright と API の起動の知識が入る。web の単体テストの設定（Vitest）と混ざる |
| 置き場所 | `apps/e2e/` | `apps/` はデプロイする app の置き場所なので、試験だけの workspace を並べると紛らわしい |
| ログイン | `apps/api/e2e/` の専用起動口に testUtils と試験用のログインの経路を足す（2026-09-28 の案） | 本番と違う起動口でアプリを組むことになり、E2E で確かめたい「本番と同じ組み立て」から離れる（#35・#39 で踏んだ種類の違い）。試験用のログインの経路が HTTP に載るため、本番の起動口に紛れ込まないことを別に守る必要がある |
| ログイン | Google の OAuth をテスト用アカウントで通す | 実アカウントのパスワードや 2 段階認証を CI に置くことになる。Google 側の画面の変化で試験が壊れる |
| ログイン | セッションの行を SQL で直接入れ、Cookie を自前で署名する | better-auth の Cookie の形式・署名に試験が依存し、better-auth の更新で壊れる。testUtils はその形式を better-auth 自身が作る |
| 結果不明 | API のプロセスを止める | 止めた時点で要求が届いたかが決まらず不安定。止めて戻すのに時間がかかる |
| 起動 | `next dev` と `nest start --watch` | 初回の組み立てで数秒待つ（M2-e で遅れた）。本番のビルドと違う |
| DB の初期化 | 試験ごとにコンテナを作り直す | 1 回に数秒かかり、M-01〜04 だけでも遅くなる |
| 起動 | Playwright の global setup で DB を起動する | `webServer` は global setup より先に起動するので、API に `DATABASE_URL` を渡せない |
| 起動 | global setup で DB・API・web をすべて自前で起動し、teardown で止める | `webServer` の待ち合わせ（ポートが開くまで待つ・ログを出す）を自作することになる。起動スクリプトで DB だけ先に作れば `webServer` をそのまま使える |
| CI | 既存の `ci.yml` にジョブを足す | ワークフロー全体の `on` に paths を付けられないため、ジョブの中で変更の有無を判定する仕組み（外部の action）が要る。別のワークフローなら `on.paths` で足りる |

## Consequences（良い影響・悪い影響・残るリスク）

- 良い: web と API をつないだときの振る舞い（Cookie、rewrites、ETag、同じ要求での確認）を毎回確かめられる。M-02・M-04 の手動確認の穴が埋まる。M3 の IndexedDB による復帰を試験できる土台になる。
- 悪い: CI の時間が増える（見込み: ビルド 2 分 + Testcontainers 30 秒 + 試験 1〜2 分）。`paths` で対象の PR に絞る。
- 悪い: `e2e/` が `apps/api` の内部（`createAuth`・`tests/support/database.ts`）を import する。API のこれらの形を変えると E2E も直す必要がある。
- 残るリスク: TRUNCATE と追記のみの保証（migration 0003）の相性。SQL の上では問題ないが、最初のスパイクで実際に確かめる（Decision 5）。
- 残るリスク: M-05（見た目）と M-06（375 幅）は手動のまま。スクリーンショット比較は入れない（見た目の判断は人が行うため）。

## Migration（移行が必要な場合の手順）

対象外（新しく足すだけ。既存の試験・CI は変えない）。

## Rollback（決定を戻す場合の手順）

`e2e/` の workspace と `e2e.yml` を消し、ルートの `package.json` の `test:e2e` と workspaces の 1 行を戻す。アプリのコードには試験用の変更を入れないので、戻すのはこれだけ。

## References（設計書・要件・関連 ADR・外部資料へのリンク）

- `logs/2026-09-30.md`（M2-e の結果。M-02 の代わりの確かめ方、M-04 のスキップ）
- `docs/tests/m2-trips-and-plans.md` の M-01〜M-04、E-21
- ADR-0002（M1 の認証。better-auth）、ADR-0003（DB のロールと migration）、ADR-0004（web の取得状態）
- `apps/api/tests/db/auth-http.db.test.ts`・`plans-http.db.test.ts`（testUtils でセッションを作る既存の形）、`apps/api/tests/support/database.ts`
- `.github/workflows/ci.yml`（既存の api-db ジョブ）
