# 要件定義: migration-deploy-check（migrationの流し忘れをデプロイの前に止める）

- 変更レベル: L3（ログインなしで読めるAPIを足す。実行用のロールに読む権限を1つ足す。デプロイのワークフローを変える）
- 作成日: 2026-11-09
- ステータス: draft
- 決めたこと: `docs/discussions/migration-deploy-check.md`（確認のページ: https://claude.ai/artifact/S9mTnGRS7fvYNYD4Dk2SWt ）

## 背景

ToDoリスト（PR #328）をデプロイしたあと、ToDoの画面が「取得できませんでした」になった（2026-11-09）。ToDoの表を作るmigrationが、開いた環境のDBにまだ流れていなかったためと推測している。migrationは管理者が手元の端末で流す決まり（ADR-0003）で、デプロイのワークフロー（`.github/workflows/deploy-vercel.yml`）はmigrationを流さず、流したかも確かめない。PR #328の説明にも、マージのあとにmigrationを流す作業が書かれていなかった。

## 目的

- DBに流していないmigrationがあるcommitを、検証用・本番のどちらにも出せないようにする。
- 止まったときに、どのmigrationが足りないかと、次に何をすればよいかがワークフローの画面でわかる。
- migrationを足したPRを読んだ人が、マージのあとに何を流すかを、PRの説明で知ることができる。

## ユーザー要求（原文の要約）

「今回の失敗は改善余地があります」。直し方として「デプロイ前に確かめて止める」を選んだ（2026-11-09）。DBに流したmigrationは、ログインなしで読める口から読む（確認のページで決定）。

## 機能要件

- F-01: APIは、ログインなしで「最後に流したmigrationの時刻」を返す。時刻は`apps/api/drizzle/meta/_journal.json`の`when`と同じ数（ミリ秒）。1本も流していなければ「無い」と返す。
- F-02: F-01が返すのは時刻1つだけ。migrationの名前・本数・ハッシュ・利用者のデータは返さない。
- F-03: デプロイのワークフローは、apiとwebを出す前に、今動いているapi（`API_ORIGIN`）にF-01を聞き、出すcommitの最後のmigrationの時刻と比べる。
- F-04: DBの時刻が出すcommitより古い、または「無い」なら、apiもwebも出さずに止める。足りないmigrationの名前（`0011_planning_todos`など）と、「管理者の端末でmigrationを流してから、もう一度出す」という案内をワークフローの記録に出す。
- F-05: DBの時刻が出すcommitと同じか新しいなら進む（前のcommitに戻して出し直すときを止めない。論点の記録で決定）。
- F-06: 今動いているapiにF-01の口がまだ無い（404）ときは、警告を出して進む。この機能を最初に出す1回と、この機能より前のcommitへ戻したあとの1回のため（論点の記録で決定）。
- F-07: 今動いているapiにつながらない、404以外のエラー、返す形が違うときは止める。
- F-08: PRのひな形に「マージのあとの作業」の欄を足す。`apps/api/drizzle/`を変えたPRでは、どの環境でmigrationを流すかをこの欄に書く。`implement-change`スキルにも同じ決まりを書く（論点の記録で決定）。

## 非機能要件（性能・セキュリティ・可用性など。無ければ「対象外」）

- セキュリティ: F-01はログインなしで読めるが、返すのは時刻1つだけ（F-02）。実行用のロール（`app_runtime`）に足すのは、Drizzleの履歴の表を読む権限だけ。書く権限・DDLは足さない。migratorの接続はGitHubにもVercelにも置かない（ADR-0003のまま）。
- 可用性: `/api/health`は今までどおりDBを読まない。画面の通し試験とE2Eの起動待ちが`/api/health`を見ているので、DBの調子で起動待ちが変わらないようにする。
- 性能: F-01は1行を返す問い合わせ1回。デプロイのときに1回呼ぶだけなので、性能の要件は対象外。

## 正常系

- N-01: migrationを流してから出す。確かめが通り、apiとwebが出る。
- N-02: migrationを足していないcommitを出す。DBの時刻が同じなので通る。
- N-03: 前のcommitに戻して出す。DBの方が新しいので通る。この機能を入れる前のcommitへ戻す場合も、確かめるスクリプトはワークフロー側の版なので動く。

## 異常系

- E-01: migrationを流し忘れて出す。apiもwebも出ずに止まり、足りないmigrationの名前が出る（今回の件）。
- E-02: 今のapiが落ちている・つながらない。止まる。
- E-03: 今のapiに口がまだ無い（この機能を最初に出す1回、またはこの機能より前のcommitへ戻したあとの1回）。警告を出して進む。
- E-04: 今のapiの口が500を返す（実行用のロールに読む権限が無いなど）。止まる。

## 境界条件（null・空・上限/下限・権限境界）

- B-01: DBの時刻とcommitの最後の時刻が同じ。通る。
- B-02: DBに1本も流していない（「無い」）。止まる（commitには必ず1本以上ある）。
- B-03: commitの`_journal.json`が読めない・空。止まる。
- B-04: ログインしていない要求でF-01を読める。ログインしていても同じものが返る。

## 前提

- migrationは後方互換の追加だけにしている（`docs/runbooks/production.md`の10章）。
- Drizzleは流したmigrationごとに`drizzle.__drizzle_migrations`に1行を足し、`created_at`に`_journal.json`の`when`を入れる。順番は`when`の順で、新しいmigrationは前のものより大きい`when`を持つ。
- `API_ORIGIN`は、Deployment Protectionを外した公開のURL（`deploy-vercel.yml`）。

## 制約

- migrationを流すのは今までどおり管理者の端末だけ（ADR-0003）。ワークフローはmigrationを流さない。
- 確かめるのは`deploy-vercel.yml`の中1か所にし、検証用と本番の両方に効かせる。

## 対象範囲

- APIの公開の口1つ（F-01）と、実行用のロールに読む権限を足すmigration。
- デプロイのワークフローの確かめの手順と、それが呼ぶ確かめるスクリプト（ワークフロー側の版で動かす）。
- PRのひな形、`implement-change`スキル、手順書（`docs/runbooks/production.md`・`docs/runbooks/integration-env.md`）の書き足し。

## 対象外

- ワークフローの中でmigrationを流すこと（論点の記録で選ばなかった）。
- 本番の前のバックアップを自動にすること。
- PRの説明に欄があるかをCIで確かめること（論点の記録で決定）。
- 今のToDoの画面が開けない件そのもの。管理者の端末でmigrationを流せば直る。

## 後方互換性・データ移行（該当なければ「対象外」）

- 表とデータは変えない。権限を足すmigrationを1本足す。
- `/api/health`の返す形は変えない。

## 受け入れ条件（Definition of Done に対応）

- 未適用のmigrationがある状態で、ワークフローの確かめが止まり、足りないmigrationの名前が出ることを試験で確かめている（E-01）。
- F-01がログインなしで時刻を返し、それ以外を返さないことを、DBつきの試験で確かめている。
- 品質ゲート（lint・type-check・test・build・`db:check`・`api:check`）が通る。
- 手順書とPRのひな形に、止まったときの直し方とマージのあとの作業の欄がある。

## 決めたこと（問いと答え）（docs/discussions/migration-deploy-check.md へのリンクだけ）

- [論点の記録](../discussions/migration-deploy-check.md)

## 未決事項（論点の記録の「仮決定」「後の工程へ」へのリンクと、件数）

- なし。仮決定だった4件（口が無いときの扱い、DBの方が新しいとき、マージのあとの作業の書き場所、確かめるスクリプトの置き場所）は、設計のPR #331のマージで決定にした（2026-11-12）。[論点の記録](../discussions/migration-deploy-check.md)。
