# 論点の記録: migrationの流し忘れをデプロイの前に止める

- 機能名: migration-deploy-check
- 確認のページ: https://claude.ai/artifact/S9mTnGRS7fvYNYD4Dk2SWt
- 進み具合: docs/discussions/migration-deploy-check.progress.json

## 背景

ToDoリスト（PR #328）をデプロイしたあと、ToDoの画面が「取得できませんでした」になった（2026-11-09）。ToDoの表を作るmigrationが、開いた環境のDBにまだ流れていなかったためと推測している。デプロイのワークフローはmigrationを流さず、流したかも確かめない。PR #328の説明にも、マージのあとにmigrationを流す作業を書いていなかった。この記録では、DBが追いついていないcommitをデプロイの前に止める方法を決める。

## 前提

- migrationは管理者が手元の端末からmigratorのロールで流す。アプリの起動時・CI・デプロイでは流さない（ADR-0003）。migratorの接続はGitHubにもVercelにも置かない。
- デプロイは`deploy-vercel.yml`の1本を、検証用（`deploy-integration`）と本番（`deploy-production`）のボタンから呼ぶ。apiを出してからwebを出す。
- Drizzleは流したmigrationを`drizzle.__drizzle_migrations`に1行ずつ残す。`created_at`には`apps/api/drizzle/meta/_journal.json`の`when`（ミリ秒）が入る。未適用かどうかは、DBの`created_at`の最大とリポジトリの最後の`when`を比べればわかる。
- `/api/health`はログインなしで読める（`health.controller.ts:8`）。今は`{ "status": "ok" }`だけを返し、DBを読まない。
- migrationは後方互換の追加だけにしている（`docs/runbooks/production.md`の10章）。前の版のコードは新しいスキーマで動く。

## 論点

### 流し忘れをどこで防ぐか

<!-- id: where-to-stop -->

- 工程: 要件
- 種類: 設計
- 優先度: 高
- 状態: 決定
- なぜ今: 作るもの全体が変わる。
- 根拠: ADR-0003はmigratorの接続を管理者の端末だけに置く。デプロイのワークフローは確かめずに出す。
- 選択肢:
  - A) デプロイのワークフローが、DBに流したmigrationとリポジトリのmigrationを比べ、足りなければ出す前に止める。PRの説明に「マージのあとの作業」を書く決まりも足す
    - 利点: 流し忘れたまま出ることが無くなる。DBのパスワードをGitHubに置かない
    - 欠点: 流すのは今までどおり手元の端末なので、出先からは直せない
  - B) migratorの接続をGitHubのEnvironmentに置き、デプロイの中でmigrationを流す
    - 利点: 出先でもボタンだけで直せる
    - 欠点: ADR-0003を変える。本番の前のバックアップは手作業のまま残る
  - C) PRの説明とログに書く決まりだけを足す
    - 利点: 作るものが少ない
    - 欠点: 書き忘れ・読み忘れると同じことが起きる
- 推奨: A（流し忘れを機械で止められ、ADR-0003の決まりも変えずに済む）
- 決定: A
- 推奨と同じか: 同じ
- 理由:
- 選ばなかった理由: B（ADR-0003を変えることになり、本番の前のバックアップは手作業のまま残る）。C（書き忘れ・読み忘れると同じことが起きる）
- 反映先: docs/requirements/migration-deploy-check.md（目的・機能要件）
- 決めた日: 2026-11-09

### DBに流したmigrationを、ログインなしで読めるようにするか

<!-- id: endpoint-access -->

- 工程: 要件
- 種類: API
- 優先度: 高
- 状態: 決定
- なぜ今: GitHubのワークフローはアプリにログインできない。読める人を決めないと、APIの形と秘密の値の要否が決まらない。
- 根拠: `/api/health`は今もログインなしで読める（`health.controller.ts:8`）。返すのは、最後に流したmigrationの時刻（`_journal.json`の`when`と同じ数）1つだけにする。
- 選択肢:
  - A) `/api/health`に、最後に流したmigrationの時刻を足す。誰でも読める
    - 利点: 秘密の値を増やさない。ワークフローは今の`API_ORIGIN`を読むだけでよい
    - 欠点: いつスキーマを変えたかが外から見える（利用者のデータは見えない）
  - B) 別の口にし、GitHubとVercelの両方に置く確認用の合言葉をヘッダーで送ったときだけ返す
    - 利点: 外からは何も見えない
    - 欠点: 秘密の値が1つ増え、GitHubの2つのEnvironmentとVercelのapiの2環境に入れて、入れ替えも4か所になる
- 推奨: A（見えるのは時刻1つで、利用者のデータにも操作にもつながらない。秘密の値を増やすと入れ忘れでデプロイが止まる場所が増える）
- 決定: A
- 推奨と同じか: 同じ
- 理由:
- 選ばなかった理由: B（秘密の値が1つ増え、入れる場所と入れ替える場所が4か所になる。入れ忘れでデプロイが止まる場所も増える）
- 反映先: docs/requirements/migration-deploy-check.md（機能要件）、docs/designs/migration-deploy-check.md（API 設計。置き場所は`/api/health`の下の`/api/health/migrations`にした。理由は設計書）
- 決めた日: 2026-11-09

### 確かめる口が無いAPIに出すとき（この機能を最初に出す1回）をどうするか

<!-- id: first-deploy -->

- 工程: 設計
- 種類: 設計
- 優先度: 中
- 状態: 仮決定
- なぜ今: 確かめは出す前に、今動いているapiに聞く。この機能を最初に出すときは、今のapiにまだ口が無い。
- 根拠: `deploy-vercel.yml`はapiを出してからwebを出す。
- 選択肢:
  - A) 今のapiに口が無い（404）ときだけ、警告を出して進める。つながらない・500は止める。この機能より前のcommitへ戻したあとの1回も、同じ道を通る
    - 利点: 最初の1回を手で飛ばす手順が要らない
    - 欠点: 404を返す壊れ方をしたときも進んでしまう
  - B) 止める。最初の1回だけ、ワークフローの入力で確かめを飛ばす
    - 利点: 確かめを黙って飛ばすことが無い
    - 欠点: 飛ばす入力がずっと残り、ふだんも押せてしまう
- 推奨: A（404は「口がまだ無い」とき以外に起きにくい。飛ばす入力を残すほうが流し忘れにつながる）

### DBの方がリポジトリより新しいとき（前のcommitを出し直すとき）を止めるか

<!-- id: db-ahead -->

- 工程: 設計
- 種類: アプリの決まり
- 優先度: 中
- 状態: 仮決定
- なぜ今: 不具合で前のcommitに戻すときに、確かめが邪魔をするかが決まる。
- 根拠: migrationは後方互換の追加だけにしていて、前の版は新しいスキーマで動く（`docs/runbooks/production.md`の10章、障害時は「DBは戻さない」）。
- 選択肢:
  - A) 通す。止めるのはDBが古いときだけ
    - 利点: 戻す手順がそのまま使える
    - 欠点: 誤って古いcommitを出しても止まらない（今と同じ）
  - B) 止める
    - 利点: 出すcommitとDBが必ずそろう
    - 欠点: 障害のときに前の版へ戻せなくなる
- 推奨: A（障害のときに戻せることを優先する。古いcommitの出し間違いは、今もSHAの承認で見ている）

### マージのあとの作業を、どこに書く決まりにするか

<!-- id: post-merge-note -->

- 工程: 設計
- 種類: 設計
- 優先度: 中
- 状態: 仮決定
- なぜ今: 流し忘れを止めても、PRを読んだ時点で作業がわかる方がよい。
- 根拠: PR #328の説明に、migrationを流す作業が無かった。`.github/pull_request_template.md`に該当の欄が無い。
- 選択肢:
  - A) PRのひな形に「マージのあとの作業」の欄を足し、`apps/api/drizzle/`を変えたPRでは「どの環境でmigrationを流すか」を書く。`implement-change`スキルにも同じことを書く
    - 利点: PRを読む人が、マージの直前に作業を見られる
    - 欠点: 書き忘れはCIでは止まらない（デプロイの確かめで止まる）
  - B) Aに加えて、CIで`apps/api/drizzle/`を変えたPRの説明に欄があるかを確かめる
    - 利点: 書き忘れも止まる
    - 欠点: PRの説明を読むCIを新しく作る。デプロイの確かめと二重になる
- 推奨: A（止める役はデプロイの確かめが持つ。PRの説明は読む人への案内なので、ひな形とスキルで足りる）

### 確かめるスクリプトをどこに置くか

<!-- id: script-location -->

- 工程: 設計
- 種類: 設計
- 優先度: 中
- 状態: 仮決定
- なぜ今: 出すcommitの作業ツリーにスクリプトを置くと、この機能より前のcommitへ戻して出すときにスクリプトが無く、確かめの手順で止まる（PR #331のDevin Reviewの指摘）。
- 根拠: `deploy-vercel.yml`は指定SHAをcheckoutして、その作業ツリーでコマンドを動かす。`docs/runbooks/production.md`の12章は、前のcommitのSHAで同じワークフローを動かす。
- 選択肢:
  - A) 依存のない`.github/scripts/check-deployed-migrations.mjs`にし、ワークフローを動かした版（`github.sha`）を別のpathに取り出して動かす。出すcommitからは`_journal.json`だけを読む
    - 利点: 前のcommitへ戻しても、確かめの手順で止まらない。`npm ci`を待たずに確かめられる
    - 欠点: ワークフローの手順が1つ増える。`apps/api`の他のCLIと置き場所がそろわない
  - B) `apps/api`のCLI（`cli:check-deployed-migrations`）にする
    - 利点: 他のCLIと置き場所がそろう
    - 欠点: この機能より前のcommitへ戻して出せなくなる
- 推奨: A（障害のときに前の版へ戻せることを優先する）
