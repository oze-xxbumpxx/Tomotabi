# 試験計画: migration-workflow（migrationを出先からも流せるようにする）

- 前提となる設計書: docs/designs/migration-workflow.md
- 要件: docs/requirements/migration-workflow.md（PR #362で承認）
- レベル: L3

## 試験種別

| 種別                 | 置き場                                    | 実行                        |
| -------------------- | ----------------------------------------- | --------------------------- |
| 一覧を作るスクリプト | `.claude/tests/plan-migrations.test.mjs`  | `npm run test:harness`      |
| ワークフローの形     | `.claude/tests/migrate-workflow.test.mjs` | `npm run test:harness`      |
| 検証用での手の確かめ | GitHubの画面                              | ユーザーとClaude Codeが行う |

apiとwebのコードは変えないので、アプリの単体の試験とE2Eは足さない。

## 単体試験観点

### 一覧を作るスクリプト（`planMigrations`と`main`）

`_journal.json`は、試験の中で`0010`〜`0012`の`tag`と`when`を持つ値を作る。`main`には`fetchImpl`・`readFile`・`summaryPath`・`outputPath`を差し替えて渡し、本物のネットワークは使わない。

| #     | 観点                                | 前提                                              | 期待結果                                                                                      | 分類 |
| ----- | ----------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---- |
| MW-01 | 全部流し済み（F-06）                | 200、`lastAppliedAt`が`0012`の`when`              | `state`は`none`、`count`は0、まとめに「流すものはありません」                                 | 正常 |
| MW-02 | DBの方が新しい（E-07）              | 200、`0012`の`when`＋1                            | `none`                                                                                        | 境界 |
| MW-03 | 1本だけ流していない（F-04）         | 200、`0011`の`when`                               | `pending`、`count`は1、まとめに`0012`の名前                                                   | 正常 |
| MW-04 | 複数を流す順に出す（F-04）          | 200、`0010`の`when`より1小さい値                  | `pending`、`count`は3、名前が`0010`・`0011`・`0012`の順                                       | 正常 |
| MW-05 | `entries`の並びに頼らない           | `entries`の順を入れ替え、200で`0010`の`when`      | 名前が`when`の小さい順に並ぶ                                                                  | 境界 |
| MW-06 | 境目の1つ下                         | 200、`0012`の`when`−1                             | `pending`、`count`は1                                                                         | 境界 |
| MW-07 | 口が無い（F-12）                    | 404                                               | `unknown`、まとめに「一覧を出せません」と理由。終了コード0                                    | 異常 |
| MW-08 | つながらない・打ち切り（F-12）      | `fetchImpl`が`TypeError`／`TimeoutError`を投げる  | `unknown`、終了コード0                                                                        | 異常 |
| MW-09 | 200以外・返す形が違う（F-12）       | 500／200でJSONでない／`{}`／`lastAppliedAt`が文字 | `unknown`、終了コード0                                                                        | 異常 |
| MW-10 | apiのURLが無い・httpsでない（F-12） | 引数が空／`http://…`                              | `unknown`、理由に変数の名前。apiを呼ばない                                                    | 異常 |
| MW-11 | 1本も流していない（B-02）           | 200、`lastAppliedAt: null`                        | 終了コード1。端末で最初の構築をするよう出す                                                   | 境界 |
| MW-12 | `_journal.json`が読めない・空       | `readFile`が`ENOENT`／`{ "entries": [] }`         | 終了コード1                                                                                   | 異常 |
| MW-13 | 出力                                | MW-03の答え                                       | `outputPath`に`state=pending`と`count=1`の行                                                  | 正常 |
| MW-14 | バックアップの確かめの文（F-07）    | `--backup-reminder`つき、MW-03の答え              | まとめに、バックアップを取って照合したかの確かめの文と、手順書の場所。`none`のときは出さない  | 正常 |
| MW-15 | 聞く先と打ち切り                    | apiのURLが`https://api.example.test`              | `https://api.example.test/api/health/migrations`を、10秒の打ち切りつきで1回だけ呼ぶ           | 正常 |
| MW-16 | 引数なし                            | 引数なしで直接動かす                              | 使い方を出して終了コード1                                                                     | 異常 |
| MW-17 | 比べる関数は共有                    | なし                                              | `plan-migrations.mjs`が、`check-deployed-migrations.mjs`の`compareMigrations`をimportして使う | 正常 |

### ワークフローの形（ファイルを読んで確かめる）

| #     | 観点                                      | 期待結果                                                                                                                           |
| ----- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| MW-20 | ボタンは手で押すときだけ動く（制約）      | `migrate-integration.yml`・`migrate-production.yml`の`on`は`workflow_dispatch`だけ。`push`・`pull_request`・`schedule`が無い       |
| MW-21 | 環境の取り違えが無い（B-03）              | 検証用は`migrate-integration`と`MIGRATE_API_ORIGIN_INTEGRATION`、本番は`migrate-production`と`MIGRATE_API_ORIGIN_PRODUCTION`を渡す |
| MW-22 | planは秘密を読まない                      | planのジョブに`environment`が無く、`secrets.`を1つも読まない                                                                       |
| MW-23 | 秘密を読むのはapplyだけ                   | `secrets.MIGRATION_DATABASE_URL`を読むのは、applyのジョブの手順だけ。`secrets: inherit`でほかのワークフローに渡さない              |
| MW-24 | applyは承認のあと、流すものがあるときだけ | applyに`environment`と`needs: plan`があり、`if`が`state`が`none`でないことを見る                                                   |
| MW-25 | `main`のcommitだけ（F-03、E-01）          | planとapplyの両方に、SHAの形の確かめと`git merge-base --is-ancestor`の確かめがある。applyは、planが決めたSHAを使う                 |
| MW-26 | 同時に動かない（F-09）                    | 2つのボタンに、環境ごとの`concurrency`の組があり、`cancel-in-progress: false`                                                      |
| MW-27 | 権限は読むだけ                            | `permissions`は`contents: read`だけ                                                                                                |
| MW-28 | 入力をシェルに直接埋め込まない            | `run`の中に`${{ inputs.`と`${{ github.event.inputs.`が無い（環境変数で渡す）                                                       |
| MW-29 | スクリプトはワークフロー側の版            | planが、`github.sha`の`.github/scripts/`を別の場所に取り出して使う                                                                 |
| MW-30 | 流したあとの報告は失敗しても動く（E-04）  | 流したmigrationの名前を書く手順に`if: always()`がある。流す手順に`continue-on-error`が無い                                         |
| MW-31 | デプロイのワークフローは変えない（F-02）  | `deploy-vercel.yml`・`deploy-integration.yml`・`deploy-production.yml`に、`db:migrate`と`MIGRATION_DATABASE_URL`が無い             |

## 結合試験観点（検証用での手の確かめ）

実装のPRのマージと、ユーザーの設定（Environment・秘密・変数）のあとに行う。

| #     | 観点                                 | 操作                                                                  | 期待結果                                                                       |
| ----- | ------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| MW-40 | 流すものが無い（F-06）               | 全部流し済みの検証用で`migrate-integration`を押す                     | 「流すものはありません」。承認を求められない                                   |
| MW-41 | 流すものがある（F-04・F-05・F-08）   | 流していないmigrationがある状態で押す                                 | 一覧が出て承認で止まる。承認すると流れ、流した名前が出る                       |
| MW-42 | 承認しない（E-05）                   | MW-41の一覧のあと、拒む                                               | 何も流れない                                                                   |
| MW-43 | 一覧を出せない（F-12）               | リポジトリの変数`MIGRATE_API_ORIGIN_INTEGRATION`を一時的に外して押す  | 「一覧を出せません」と出て承認で止まる。承認すると、流していないものだけ流れる |
| MW-44 | ブランチからは秘密を読めない（E-08） | `main`以外のブランチで、同じEnvironmentを指定したワークフローを動かす | 始まらない（ブランチの決まりで止まる）                                         |
| MW-45 | ログに接続文字列が出ない             | MW-41の実行のログを全部読む                                           | 接続文字列・パスワードが出ていない                                             |
| MW-46 | 端末と食い違わない（F-10）           | ボタンで流したあと、端末で`npm run db:migrate`を動かす                | 流すものが無い                                                                 |
| MW-47 | デプロイの確かめの案内               | 流し忘れた状態で`deploy-integration`を押す                            | 止まり、案内に`migrate-integration`のボタンが出る                              |

MW-44は、試しのワークフローをブランチに置く必要がある。試したあと、ブランチを消す。

## 特性観点

- 権限: 秘密を読めるのがapplyだけ（MW-22・MW-23）、`main`だけ（MW-25・MW-44）。
- データ整合性: 途中で失敗したら、前のmigrationまでが流し済みで残る（`drizzle-kit migrate`の動き。MW-30で報告の手順を確かめる）。
- 冪等性: 続けて押しても2回目は流れない（MW-40・MW-46）。
- 障害系: apiを読めないとき（MW-07〜MW-10・MW-43）。DBにつながらないときは、流す手順が失敗して止まる（手の確かめはしない。秘密を外して試すと、置き直しが要るため）。
- フロントエンド・防御性: 対象外（画面もDomainも変えない）。

## メソッド網羅チェック表

| ファイル              | 関数                              | 対応する試験観点           |
| --------------------- | --------------------------------- | -------------------------- |
| `plan-migrations.mjs` | `planMigrations(journal, answer)` | MW-01〜MW-06、MW-11        |
| `plan-migrations.mjs` | `main(argv, deps)`                | MW-07〜MW-10、MW-12〜MW-16 |
| `plan-migrations.mjs` | まとめの文を作る関数              | MW-01、MW-03、MW-07、MW-14 |

## 回帰試験範囲

- `.claude/tests/deploy-integration-workflow.test.mjs`（デプロイのワークフローの形）。変えないので通ったまま。
- `.claude/tests/check-deployed-migrations.test.mjs`。案内の文を変えるので、文を確かめている観点だけ直す。

## 試験データ

- `_journal.json`: 試験の中で作る値。本物のファイルは読まない。
- 検証用での確かめは、次にDBを変える変更（または`migration-deploy-check`の`0015`）で行う。

## 完了条件

- MW-01〜MW-31が`npm run test:harness`で通る。
- MW-40〜MW-47を検証用で確かめ、結果をPRか公開の記録に書く。
- `npm run lint` / `npm run type-check` / `npm test` / `npm run build`が通る（アプリのコードは変えないので、通ったままであること）。
