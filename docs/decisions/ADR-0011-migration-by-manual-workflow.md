# ADR-0011: migrationを、承認つきの手動のワークフローからも流せるようにする

- Status: Proposed（要件のPRのマージで Accepted にする）
- Date: 2026-11-15
- 関連feature: migration-workflow

## Context（背景・なぜ判断が必要か）

ADR-0003の決定3は、migrationの適用を「管理者が明示的に行う。`MIGRATION_DATABASE_URL`を使う。アプリの起動時、PRのCI、本番への自動デプロイでは適用しない」と決めた。運用では、管理者の端末から`npm run db:migrate`を流している。

デプロイはGitHubのボタンでスマートフォンからも押せるが、migrationは端末が要る。出先ではDBを変える変更を出せない。2026-11-09には、migrationを流さないままデプロイして本番のToDoが読み込めなくなった。

## Decision（採用した決定）

ADR-0003の決定3を、次のように改める。決定1・2・4・5は変えない。

1. **migrationは、管理者の端末か、承認つきの手動のワークフローから流す。** どちらも、管理者が自分の意思で始める。アプリの起動時、PRのCI、マージ、デプロイのワークフローでは流さない（ここはADR-0003のまま）。
2. **ワークフローは環境ごとに分ける。** 検証用と本番で、ボタン・Environment・秘密を分ける。
3. **migratorの接続は、migration専用のEnvironmentの秘密に置く。** そのEnvironmentは、使えるブランチを`main`だけにし、承認を必須にする。デプロイ用のEnvironmentには置かない。
4. **流せるのは`main`の履歴にあるcommitだけ。** 流す前に、流れるmigrationの一覧を出してから承認を求める。一覧は秘密を使わずに作る（今動いているapiが返す「最後に流したmigrationの時刻」と、commitの`_journal.json`を比べる）。migratorの接続を読むのは、承認のあとの流すジョブだけ。
5. **本番のバックアップの決まりは変えない。** 本番でDBを変える前は、端末でバックアップを取って照合する。

## Alternatives（検討した非採用案と却下理由）

| 案                                              | 却下理由                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 今のまま、管理者の端末だけで流す                | 出先でDBを変える変更を出せない。流すのが後回しになり、流し忘れの原因になる                   |
| デプロイのボタンが、出す前にmigrationも流す     | デプロイのたびにmigratorの接続を使う。DBを変える操作と、アプリを出す操作を別々に承認できない |
| クラウドのClaude Codeのセッションから流す       | migratorの接続を、セッションの環境の変数に平文で置くことになる                               |
| NeonのSQLの画面にSQLを貼って流す                | Drizzleの履歴の表に記録が残らず、次の`db:migrate`が同じSQLを流そうとして失敗する             |
| migratorの接続を、デプロイ用のEnvironmentに置く | Vercelのコマンドを動かすデプロイのジョブも、DBの持ち主の接続を読めてしまう                   |
| ワークフローが本番のdumpを取ってGitHubに置く    | 二人の実データが、暗号化されていてもGitHubに置かれる                                         |

問いと答えの詳しい記録は`docs/discussions/migration-workflow.md`。

## Consequences（良い影響・悪い影響・残るリスク）

- 良い: 出先でも、検証用から本番まで、DBを変える変更を出せる。
- 良い: 誰が・いつ・どのcommitのmigrationを流したかが、ワークフローの実行の履歴に残る。
- 悪い: migratorの接続が、管理者の端末とパスワード管理ソフトのほかに、GitHubの秘密にも置かれる。migratorのパスワードを替えたら、GitHubの秘密も入れ直す。
- 悪い: Environmentが2つ増える。
- 残るリスク: GitHubのアカウントが乗っ取られると、migratorの接続でDBを作り変えられる。GitHubの2段階の認証と、Environmentの承認で抑える。
- 残るリスク: 出先で本番に流せるのは、出かける前にバックアップを取ってあるときだけ。Neonの「時点を指定して戻す」機能でバックアップに代えられるかは、まだ確かめていない。

## Migration（移行が必要な場合の手順）

1. GitHubにmigration専用のEnvironmentを2つ作り、使えるブランチを`main`だけにして、承認を付ける。保護を付けてから、migratorの接続を秘密に置く。
2. 検証用のボタンで、流すものがある場合と無い場合を試す。
3. 手順書を直す。

## Rollback（決定を戻す場合の手順）

ワークフローのファイルを消し、GitHubのEnvironmentと秘密を消す。migratorのパスワードを替える。端末から流す手順は残してあるので、そのまま使える。DBは変えていないので、戻すものは無い。

## References（設計書・要件・関連ADR・外部資料へのリンク）

- docs/requirements/migration-workflow.md、docs/discussions/migration-workflow.md
- ADR-0003（本番migrationの方式とDBロールの分離）
- docs/designs/migration-deploy-check.md（流し忘れをデプロイの前に止める）
- docs/runbooks/production.md、docs/runbooks/integration-env.md、docs/runbooks/backup-and-restore.md
