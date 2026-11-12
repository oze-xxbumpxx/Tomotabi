# 試験計画: migration-deploy-check（migrationの流し忘れをデプロイの前に止める）

- 要件定義: `docs/requirements/migration-deploy-check.md`
- 設計書: `docs/designs/migration-deploy-check.md`
- 実装計画: `docs/implementation-plans/migration-deploy-check.md`
- レベル: L3

## 何を確かめるか

DBに流していないmigrationがあるcommitを出そうとすると、ワークフローがapiもwebも出さずに止まり、足りないmigrationの名前を出すことを確かめる（今回の件、E-01）。判定は確かめるスクリプトの純粋関数で、設計書の判定の表の行を全部試験する。apiの口は、ログインなしで時刻1つだけを返すことを、DBなしとDBつきの両方で確かめる。

ワークフローそのものは手元で動かせない。手順の位置と中身は`deploy-integration-workflow.test.mjs`で文字列として確かめ、通る・警告で進む・前のcommitへ戻す、の3つは結合検証環境で1回ずつ動かして見る。

## 試験種別

| 種別                     | 置き場所                                                                   | 動かすコマンド                                     |
| ------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------- |
| apiの単体（DBなし）      | `apps/api/tests/http/health-migrations.http.test.ts`                       | `npm test -w @tomotabi/api`                        |
| apiの結合（DBつき）      | `apps/api/tests/db/migration-status.db.test.ts`                            | `npm run test:db -w @tomotabi/api`（CIの`api-db`） |
| 確かめるスクリプトの単体 | `.claude/tests/check-deployed-migrations.test.mjs`                         | `npm run test:harness`（CIの`harness`）            |
| ワークフローの形         | `.claude/tests/deploy-integration-workflow.test.mjs`（今のファイルに足す） | `npm run test:harness`                             |
| 結合検証環境での確かめ   | 人が動かし、下の記録の表に書く                                             | `deploy-integration`のボタン                       |

## apiの口

### DBなし（`health-migrations.http.test.ts`）

`probe.http.test.ts`と同じく`AppModule`を`createHttpTestApp`で立てる。`DATABASE_URL`は無いので、メモリの実装が選ばれる。

| #     | 観点                           | 前提                               | 操作                         | 期待結果                                              | 分類 |
| ----- | ------------------------------ | ---------------------------------- | ---------------------------- | ----------------------------------------------------- | ---- |
| MD-01 | ログインなしで読める（B-04）   | セッションの検証が「未ログイン」   | `GET /api/health/migrations` | 200、本文が`{ lastAppliedAt: null }`と`toEqual`で一致 | 正常 |
| MD-02 | ログインしていても同じ（B-04） | セッションの検証が「ログイン済み」 | 同じ                         | 200、本文が同じ                                       | 正常 |
| MD-03 | `/api/health`は変わらない      | 同じ                               | `GET /api/health`            | 200、`{ status: "ok" }`（既存のA-15がそのまま通る）   | 回帰 |

### DBつき（`migration-status.db.test.ts`）

`startPostgres`・`createRoles`・`migrateAsMigrator`で、本番と同じ手順で全migrationを流したDBを作る。読むのは`app_runtime`の接続（`poolFor("app_runtime")`）。

| #     | 観点                                             | 前提                                                                     | 操作                                                                      | 期待結果                                                                              | 分類 |
| ----- | ------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---- |
| MD-04 | 最後に流したmigrationの時刻を返す（F-01）        | 全migrationを流した                                                      | `PgMigrationStatus(app_runtimeのpool).lastAppliedAt()`                    | `_journal.json`の`when`の最大と一致し、型は`number`                                   | 正常 |
| MD-05 | 1本も流していない（B-02の前提）                  | ロールだけ作り、`drizzle`スキーマと表を空で作り、`0013`と同じGRANTを流す | 同じ                                                                      | `null`                                                                                | 境界 |
| MD-06 | 実行用のロールは読むだけ（非機能のセキュリティ） | 全migrationを流した                                                      | `app_runtime`で`INSERT INTO drizzle.__drizzle_migrations`と`DELETE`を試す | どちらも権限のエラー（SQLSTATE `42501`）                                              | 異常 |
| MD-07 | HTTPで返すのは時刻1つだけ（F-02）                | `DATABASE_URL`を`app_runtime`のURLにして`AppModule`を立てる              | `GET /api/health/migrations`をログインなしで                              | 200。本文のキーが`["lastAppliedAt"]`だけ（`Object.keys`を`toEqual`）、値はMD-04と同じ | 正常 |
| MD-08 | 読む権限が無いと500（E-04）                      | `0013`のGRANTを`REVOKE`で外した                                          | MD-07と同じ要求                                                           | 500。本文に表の名前・SQLの文が出ない（共通のエラーの形）                              | 異常 |

MD-05は、`drizzle-kit`の`migrate`を通さずに空の表を作る。作る文は`drizzle-orm`の`migrate`が使う文と同じ列（`id`・`hash`・`created_at`）にする。

## 確かめるスクリプト（`check-deployed-migrations.test.mjs`）

`compareMigrations`と`main`をimportして試す。`main`には`fetchImpl`・`readFile`・`summaryPath`を差し替えて渡し、本物のネットワークは使わない。試験用の`_journal.json`は、`0010`〜`0012`の3行（`when`は`1791384966637`・`1794122827791`・`1794122838776`）を持つ値を試験の中で作る。

### 判定（設計書の判定の表の全行）

| #     | 観点                                     | 前提（今のapiの答え）                                                                                            | 期待結果                                                                                                                     | 分類 |
| ----- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---- |
| MD-10 | 同じなら通す（B-01、N-02）               | 200、`lastAppliedAt`が`0012`の`when`                                                                             | `pass`、`missing`は`[]`                                                                                                      | 境界 |
| MD-11 | DBが新しければ通す（F-05、N-03）         | 200、`0012`の`when`＋1                                                                                           | `pass`                                                                                                                       | 正常 |
| MD-12 | 1本足りなければ止める（E-01）            | 200、`0011`の`when`                                                                                              | `fail`、`missing`が`["0012_planning_todos_grants"]`                                                                          | 異常 |
| MD-13 | 足りないものを全部出す（F-04、今回の件） | 200、`0010`の`when`                                                                                              | `fail`、`missing`が`["0011_planning_todos", "0012_planning_todos_grants"]`（過不足なし）、`message`が設計書の案内の1文と一致 | 異常 |
| MD-14 | DBが1本も流していない（B-02）            | 200、`lastAppliedAt: null`                                                                                       | `fail`、`missing`が3本全部                                                                                                   | 境界 |
| MD-15 | DBの時刻がcommitの`when`の境目の1つ下    | 200、`0012`の`when`−1                                                                                            | `fail`、`missing`が`["0012_planning_todos_grants"]`                                                                          | 境界 |
| MD-16 | 口が無い（F-06、E-03）                   | 404                                                                                                              | `warn`                                                                                                                       | 正常 |
| MD-17 | 404以外のエラー（F-07、E-04）            | 500 / 401 / 302 のそれぞれ                                                                                       | どれも`fail`                                                                                                                 | 異常 |
| MD-18 | つながらない（E-02）                     | `fetchImpl`が`TypeError`を投げる                                                                                 | `fail`                                                                                                                       | 異常 |
| MD-19 | 打ち切り（F-07）                         | `fetchImpl`が`TimeoutError`の`DOMException`を投げる                                                              | `fail`                                                                                                                       | 異常 |
| MD-20 | 返す形が違う（F-07）                     | 200で、本文がJSONでない / `{}` / `{ lastAppliedAt: "1794122838776" }`（文字列）/ `{ lastAppliedAt: 1.5 }` / 配列 | どれも`fail`                                                                                                                 | 異常 |
| MD-21 | `_journal.json`が読めない（B-03）        | `readFile`が`ENOENT`を投げる                                                                                     | `fail`。apiには聞かない（`fetchImpl`が呼ばれない）                                                                           | 異常 |
| MD-22 | `_journal.json`が空（B-03）              | `{ "entries": [] }` / `{}` / JSONでない                                                                          | どれも`fail`、apiには聞かない                                                                                                | 境界 |
| MD-23 | `entries`の並びに頼らない                | `entries`の順を入れ替えた`_journal.json`、200で`0011`の`when`                                                    | MD-12と同じ結果                                                                                                              | 防御 |

### 本体（`main`）

| #     | 観点                                     | 前提                                                                  | 操作                                                                                                                                                        | 期待結果                                                                                                     | 分類 |
| ----- | ---------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---- |
| MD-24 | 終了コード                               | MD-10・MD-16・MD-12の答え                                             | `main`                                                                                                                                                      | 0・0・1                                                                                                      | 正常 |
| MD-25 | 聞く先と打ち切り                         | `API_ORIGIN`が`https://api.example.test`（末尾の`/`あり・なしの両方） | `main`                                                                                                                                                      | `fetchImpl`が`https://api.example.test/api/health/migrations`で1回だけ呼ばれ、`signal`が渡る。再試行しない   | 正常 |
| MD-26 | ワークフローの記録に書く                 | `summaryPath`に一時ファイル、MD-13の答え                              | `main`                                                                                                                                                      | 要約に、DBの時刻・commitの最後の時刻・足りない2つの名前が出る。標準出力に`::error::`、MD-16では`::warning::` | 正常 |
| MD-27 | 出すcommitの作業ツリーに依らない（N-03） | `_journal.json`だけを一時フォルダに置き、作業フォルダをそこへ移す     | `node .github/scripts/check-deployed-migrations.mjs <origin> <一時フォルダの_journal.json>`を子プロセスで動かす（聞く先は試験の中で立てた`http`のサーバー） | 終了コード0。スクリプトは一時フォルダの外のファイルを読まない                                                | 正常 |
| MD-28 | 引数が足りない                           | 引数なし / 1つだけ                                                    | `main`                                                                                                                                                      | 使い方を出して1                                                                                              | 異常 |
| MD-29 | importしただけでは動かない               | なし                                                                  | 試験からimportする                                                                                                                                          | `fetch`も`process.exitCode`の変更も起きない                                                                  | 防御 |

## ワークフローの形（`deploy-integration-workflow.test.mjs`に足す）

| #     | 観点                                   | 期待結果                                                                                                                                                                                                                                                                                        | 分類 |
| ----- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| MD-30 | 確かめは出す前（F-03、F-04）           | `deploy-vercel.yml`の中で、`Verify database migrations are applied`が`setup-node`より後、`npm ci`・`Deploy api to Vercel`・`Deploy web to Vercel`より前                                                                                                                                         | 正常 |
| MD-31 | スクリプトはワークフロー側の版（N-03） | `Checkout deploy tooling from the workflow ref`が`ref: ${{ github.sha }}`・`path: .workflow`・`sparse-checkout: .github/scripts`・`persist-credentials: false`。確かめの`run`が`node .workflow/.github/scripts/check-deployed-migrations.mjs "$API_ORIGIN" apps/api/drizzle/meta/_journal.json` | 正常 |
| MD-32 | 確かめが失敗を握りつぶさない           | 確かめの手順に`continue-on-error`・`if: always()`・`\|\| true`が無い。`API_ORIGIN`は`vars.API_ORIGIN`から`env`で渡す（`run`に直接埋めない）                                                                                                                                                     | 防御 |

## 結合検証環境での確かめ（マージのあと）

設計書の「移行とリリース」の順で動かし、結果を下の記録の表に書く。

| #     | 観点                                   | 前提                                                | 操作                                                           | 期待結果                                       |
| ----- | -------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| MD-40 | 最初の1回は警告で進む（F-06、E-03）    | 検証用のDBに`0011`〜`0013`を流した。動くapiは前の版 | `deploy-integration`（SHAは空）                                | 確かめで`::warning::`が出て、apiとwebが出る    |
| MD-41 | 2回目は通る（N-01、N-02）              | MD-40のあと                                         | もう一度`deploy-integration`                                   | 確かめが通り、要約に2つの時刻が同じ値で出る    |
| MD-42 | 口がログインなしで読める（F-01）       | MD-41のあと                                         | 検証用の`API_ORIGIN`の`/api/health/migrations`をブラウザで開く | `{"lastAppliedAt":<0013のwhen>}`だけが返る     |
| MD-43 | この機能より前のcommitへ戻せる（N-03） | MD-41のあと                                         | この機能のマージより前のmainのcommitのSHAを指定して出す        | 確かめが通り（DBの方が新しい）、apiとwebが出る |
| MD-44 | 戻したあとの1回は警告で進む（F-06）    | MD-43のあと（動くapiに口が無い）                    | SHAを空にして出す                                              | `::warning::`が出て進む。その次の回は通る      |

止まる場合（E-01）は結合検証環境では起こさない。DBを古くする操作が要り、検証用のDBを壊すおそれがあるため、MD-12〜15の単体試験で確かめる。

### 記録

| #     | 日付 | 出したcommit | 結果 | メモ |
| ----- | ---- | ------------ | ---- | ---- |
| MD-40 |      |              |      |      |
| MD-41 |      |              |      |      |
| MD-42 |      |              |      |      |
| MD-43 |      |              |      |      |
| MD-44 |      |              |      |      |

## 特性観点

- 権限: 口はログインなしで読める（MD-01・02・07）。実行用のロールは履歴の表を読むだけで、書けない（MD-06）。
- データ整合性: 返す時刻は`_journal.json`の`when`と同じ数（MD-04）。bigintの文字列から数へ直すとき、安全な整数でなければ500にする（実装計画）。
- 冪等性: 対象外。口は読むだけで、スクリプトも何も書き換えない。
- 障害系: つながらない・打ち切り・404以外のエラーは止める（MD-17〜19）。再試行はしない（MD-25）。
- フロントエンド: 対象外（webは変えない）。
- 防御性: 返す形の違い（MD-20）、`entries`の並び（MD-23）、importしただけで動かない（MD-29）。EntityとValue Objectは足さないので、防御的コピー・`updatedAt`は対象外。

## メソッド網羅チェック表

| 対象                            | メソッド             | 試験観点          |
| ------------------------------- | -------------------- | ----------------- |
| `PgMigrationStatus`             | `lastAppliedAt`      | MD-04・05・06     |
| `InMemoryMigrationStatus`       | `lastAppliedAt`      | MD-01             |
| `GetMigrationStatusUseCase`     | `execute`            | MD-01・07         |
| `HealthController`              | `get`（既存）        | MD-03             |
| `HealthController`              | `migrations`（新規） | MD-01・02・07・08 |
| `check-deployed-migrations.mjs` | `lastJournalEntry`   | MD-21・22・23     |
| `check-deployed-migrations.mjs` | `compareMigrations`  | MD-10〜20・23     |
| `check-deployed-migrations.mjs` | `main`               | MD-24〜29         |

## 要件の観点との対照

| 要件                   | 試験観点                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| F-01                   | MD-01・04・07・42                                                                                    |
| F-02                   | MD-07・42                                                                                            |
| F-03                   | MD-30                                                                                                |
| F-04                   | MD-12・13・26・30                                                                                    |
| F-05                   | MD-11                                                                                                |
| F-06                   | MD-16・40・44                                                                                        |
| F-07                   | MD-17〜20                                                                                            |
| F-08                   | 試験なし。PRのひな形と`implement-change`の書き足しをレビューで見る（文書だけで、動くものが無いため） |
| N-01・N-02             | MD-10・41                                                                                            |
| N-03                   | MD-11・27・31・43                                                                                    |
| E-01                   | MD-12・13                                                                                            |
| E-02                   | MD-18                                                                                                |
| E-03                   | MD-16・40                                                                                            |
| E-04                   | MD-08・17                                                                                            |
| B-01                   | MD-10                                                                                                |
| B-02                   | MD-05・14                                                                                            |
| B-03                   | MD-21・22                                                                                            |
| B-04                   | MD-01・02                                                                                            |
| 非機能（セキュリティ） | MD-06・07                                                                                            |
| 非機能（可用性）       | MD-03                                                                                                |

## 回帰試験範囲

- `/api/health`: 既存の`probe.http.test.ts`（A-15）と`server-timing.db.test.ts`の「DBの時間が0」がそのまま通る。
- E2Eの起動待ち（`e2e/playwright.config.ts`）が`/api/health`のままで、CIの`e2e`が通る。
- 既存の`deploy-integration-workflow.test.mjs`の試験（PW-01〜）が全部通る。
- DBの試験全部（`api-db`）。`0013`が既存の権限を変えないこと。

## 試験データ

- `_journal.json`: 試験の中で、`0010`〜`0012`の`tag`と`when`を持つ値を作る。本物のファイルは読まない（migrationが増えても試験が変わらないように）。
- DBつきの試験: 本物の`apps/api/drizzle/`の全migration。MD-04の期待値は試験の中で本物の`_journal.json`から読む。

## 完了条件

- 必須: MD-01〜08、MD-10〜29、MD-30〜32が通る。品質ゲート（lint・type-check・test・build・`db:check`・`api:check`・`test:harness`）が通る。
- マージのあと: MD-40〜44を結合検証環境で確かめ、記録の表を埋める。本番はそのあと設計書の手順で出す。
