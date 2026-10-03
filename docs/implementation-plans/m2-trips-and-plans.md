# 実装計画: m2-trips-and-plans

- 前提となる設計書: docs/designs/m2-trips-and-plans.md（2026-09-27承認）、docs/requirements/m2-trips-and-plans.md、ADR-0004、ADR-0003
- 試験計画: docs/tests/m2-trips-and-plans.md
- レベル: L3
- 実装ルート: できるだけDevinに委譲する（2026-09-27ユーザー判断）。Claude CodeはIssueの作成・レビュー・手動確認の準備・スクリーンショットの確認依頼を担う
- 判断理由: 変更量が大きく、共通部品・API・画面で層が分かれるため、7つのPRに分ける。各PRはDevinの1セッションで終わる大きさにし、試験計画の観点IDで完了を判定できるようにする

## PRの分け方

| PR | 範囲 | 手順 | 観点 | Devinのeffort | マージ後にできること |
|---|---|---|---|---|---|
| M2-a1 | DBの土台 | 1〜3 | D-01〜D-10 | high | 8表・トリガー・GRANTがそろい、権限テストがCIで回る |
| M2-a2 | 書き込みの共通部品と契約 | 4〜8 | U-01〜U-07、U-12〜U-16 | max | エラー形式・ETag・Idempotency・ZodのPipe・Domainの値型、trips.json / planning.jsonと生成物がそろう |
| M2-a3 | 旅行のAPI | 9〜11 | U-08、U-17〜U-19、T-01〜T-18 | max | 旅行の作成・一覧・取得・名前・期間・開始・終了が実DBで動く |
| M2-c1 | webの基盤 | 12〜15 | W-07〜W-15、W-24、W-25 | high | TanStack Query・保存状態・共通の状態表示・シート等の部品がそろう（画面はまだ） |
| M2-b | 予定のAPIとしおり | 16〜18 | U-09〜U-11、U-20、P-01〜P-15 | max | 予定のCRUD相当としおりが実DBで動く |
| M2-c2 | 旅行の画面と入口 | 19〜21 | W-01〜W-06、W-22、W-23 | high | ログイン後に旅行を作り・選び・開始 / 終了できる |
| M2-d | しおり・予定の画面 | 22〜24 | W-16〜W-21 | high | しおりで予定の追加・編集・移動・取りやめができる |
| M2-e | 手動確認 | 25 | M-01〜M-06 | —（Claude Codeとユーザー） | M2の完了 |

委譲の順序は **a1 → a2 → a3 → c1 → b → c2 → d → e**。ローカルのDevinは同じクローンで2つ同時に動かさないため、1つずつ進める（前のPRのマージ後に次のIssueを渡す）。c1はa2（契約と生成物）だけに依存するので、a3と並べたい場合はクラウドのDevinで並行できる（ユーザーの指示があるときだけ）。

各PRは単独で品質ゲート（lint / type-check / test / test:api-db / build / api:check）を通す。

## 変更対象ファイル

| path | なぜ変えるか |
|---|---|
| `apps/api/src/app.module.ts` | PlanningModule、composition、APP_FILTER（ApiErrorFilter）を登録 |
| `apps/api/package.json` | `zod`をdependenciesに追加（ADR-0004） |
| `apps/api/src/infrastructure/database/schema/index`（drizzle.configのschema指定） | planning・record・infraのスキーマを追加 |
| `orval.config.ts` | trips.json・planning.jsonのweb用client / zodとapi用zod（`strict`、入力bodyの`maxLength`を外すtransformer）を追加 |
| `package.json`（ルート） | `api:check`の差分確認に`apps/api/src/generated`を足す |
| `apps/web/package.json` | `@tanstack/react-query`を追加 |
| `apps/web/src/app/layout.tsx` | providersを挟む |
| `apps/web/src/app/page.tsx`、`screens/home/*` | 最小ホームを入口（F-23）に置き換える。表示名とログアウトはメニューへ移す。foundationの検証パネルへの導線を外す（未決事項2） |
| `apps/web/src/shared/api/{api-failure,http-client}.ts` | codeとETag（設計書「ApiFailureの拡張」） |
| `apps/web/src/features/auth/model/use-sign-out.ts` | ログアウト成功時に選択中の旅行の保存値を消す |
| `apps/web/src/app/globals.css` | シート・ダイアログ・日付バー・状態表示のスタイル（v3のトークンだけを使う） |

## 新規作成ファイル

設計書「変更後構成」のとおり。主なもの:

| path | 役割 |
|---|---|
| `apps/api/drizzle/0002_*.sql`・`0003_*.sql`・`0004_*.sql` | 表（generate）、トリガー（custom）、GRANT（custom） |
| `apps/api/src/infrastructure/database/schema/{planning,record,infra}.ts` | Drizzleスキーマ |
| `apps/api/src/common/domain/{local-date,local-time,bounded-text}.ts` | 値型 |
| `apps/api/src/common/http/*`、`common/idempotency/*` | 書き込みの共通部品 |
| `apps/api/src/adapter/clock/clock.ts`、`infrastructure/clock/system-clock.ts` | 時刻のIFと実装 |
| `apps/api/src/modules/planning/**` | 旅行・予定のモジュール |
| `apps/api/src/modules/record/infrastructure/pg-record-history.query.ts` | 履歴の照会 |
| `apps/api/src/modules/identity/infrastructure/pg-participants.query.ts` | allowlistの二人の照会 |
| `apps/api/src/composition/planning-composition.module.ts` | portと照会実装の配線 |
| `apps/api/src/generated/*.zod.ts` | API用のZod（生成物） |
| `packages/contracts/openapi/{trips,planning}.json`、`src/{trip,plan}.ts` | 契約とwire型 |
| `apps/web/src/app/providers.tsx`、`app/trips/**` | ルート |
| `apps/web/src/screens/{trips,itinerary,plan-detail,plan-form}/*` | 画面 |
| `apps/web/src/features/{trips,plans}/{ui,model,api}/*`、`index.ts` | 機能 |
| `apps/web/src/shared/api/{mutation-request,query-client}.ts`、`shared/lib/*`、`shared/ui/*`、`shared/browser/selected-trip-store.ts` | 共通 |
| テスト一式 | 下の「テスト計画」の配置 |

## 実装手順

### M2-a1: DBの土台

1. **スキーマ定義** … `schema/planning.ts`・`record.ts`・`infra.ts`。設計書「DB設計 > 表」と参照SQL（03・04・01）を移す。tripsとtrip_participantsの相互参照FK（started_by / finished_by）がgenerateで期待どおりに出なければ、カスタムmigrationに移す。完了条件: `db:generate`が差分なしで再現し、`db:check`が通る
2. **カスタムmigration** … `0003`: `infra.reject_history_mutation()`と2表のトリガー。`0004`: スキーマのUSAGEと、設計書「GRANT」の表どおりの権限（DELETEなし、UPDATEは列指定）。完了条件: 空DBとM1適用済みDBの両方に`db:migrate`が通り、2回目は何もしない
3. **DBテスト** … `tests/db/planning-schema.db.test.ts`。D-01〜D-10。D-10は「allowlistをFOR SHAREできない」ことの固定（設計の差分1の根拠）。完了条件: `test:api-db`が成功

### M2-a2: 書き込みの共通部品と契約

4. **Orvalの確認（スパイク）** … trips.jsonを仮に置き、API用のZod出力で次を確かめる。`override.zod.strict.body`で`.strict()`が出るか、input transformerで入力bodyの`maxLength`だけを外せるか（応答の型には残す）、`format: date`の扱い。結果を設計書の「リスク」に書き戻す。想定と違えばClaude Codeに戻す（Devinは設計を変えない）。完了条件: 3点の結果がPRの説明にある
5. **契約** … 詳細設計のopenapi.trips.json・openapi.planning.jsonからM2の13操作を`packages/contracts/openapi/trips.json`・`planning.json`に移す。getTripはtrips.jsonに1つだけ。home・achievements・bookings・recordsは移さない。Errorスキーマは`{ code, message, requestId, retryable }`。`src/trip.ts`・`plan.ts`にwire型。完了条件: `api:generate`でweb用・api用の生成物ができ、`api:check`が差分なし
6. **Domainの値型** … `local-date`・`local-time`・`bounded-text`。完了条件: U-01〜U-07
7. **HTTPの共通部品** … `api-error.ts`・`api-error.filter.ts`（APP_FILTER。requestIdはpino-httpの要求id）、`etag.ts`、`idempotency-key.ts`、`zod-body.pipe.ts`、`command-receipt.ts`（request_hash）。M1のGuardの例外も新しい形になることを確かめる。完了条件: U-12〜U-16。M1の既存テストがすべて通る
8. **Clock** … `adapter/clock/clock.ts`（nowと「日本時間の今日」）、`system-clock.ts`。完了条件: U-20の日付計算部分（日本時間の境界）が通る

### M2-a3: 旅行のAPI

9. **TripとUnitOfWork** … `domain/trip.ts`・`trip-period.ts`、`PlanningWorkContext`、`PgPlanningUnitOfWork`、`drizzle-trip.repository.ts`、`pg-participants.query.ts`（ロックなし。差分1）、receiptの読み書き、guardのINSERT。完了条件: U-08
10. **UseCaseとController** … create / list / get / rename / change-period（予定の日付の検証はplans表を読むだけ。M2-bの前でも予定は表に直接入れてテストできる）/ start / finish。設計書「書き込みの共通の流れ」の順序。同じキーの同時作成はPK違反 → ロールバック → 新しいトランザクションで読み直し。完了条件: U-17〜U-19
11. **HTTP + DBテスト** … `tests/db/trips-http.db.test.ts`。T-01〜T-18。T-03はguardのINSERTで失敗させる注入（テスト用のRepositoryの差し替え。本番コードに注入口を足さない）、T-06は2接続。完了条件: `test:api-db`が成功

### M2-c1: webの基盤

12. **TanStack Query** … `app/providers.tsx`、`shared/api/query-client.ts`（設計書の既定値）。Next.js 16 / React 19で動くことを最初に確かめる。完了条件: 既存のwebテストが通る
13. **ApiFailureとhttp-clientの拡張** … code（許可リスト）とETag。message・requestIdは取り出さない。完了条件: W-25
14. **保存の要求と状態** … `mutation-request.ts`と、featureのmodelが使う保存状態のhook（editing / saving / succeeded / rejected / unknown / session-expired / conflict）。完了条件: W-07〜W-12、W-24（テスト用の小さなフォームで確かめる）
15. **共通の部品と状態表示** … `shared/ui`のsheet・dialog・field・segmented・toast、`shared/ui/state/*`（v1の読み込み・更新中・更新できていません、C-1〜C-5）。v3のREADMEと`Tomotabi 画面一式 v3.dc.html`の20〜24を見て作る。完了条件: W-13〜W-15

### M2-b: 予定のAPIとしおり

16. **Planと照会** … `domain/plan.ts`・`plan-kind.ts`、`drizzle-plan.repository.ts`、`pg-record-history.query.ts`（履歴の有無と有効な達成・予約）、`pg-planning-read.ts`（しおりと予定詳細。有効な記録をLEFT JOIN）、compositionの配線。完了条件: U-09〜U-11
17. **UseCaseとController** … get-itinerary（日付の既定はClock）、create / get / update / move / cancel。ロック順序は設計書の表どおり。完了条件: U-20、`tests/db/plans-http.db.test.ts`のP-01〜P-12
18. **同時実行のテスト** … P-13〜P-15を2接続で。完了条件: `test:api-db`が成功（10回続けて流して不安定にならないことをPRの説明に書く）

### M2-c2: 旅行の画面と入口

19. **features/trips** … api（生成関数 + `callApi`）、model（一覧・取得・作成・名前・期間・開始・終了）、ui（旅行カード、作成フォーム、メニュー、終了の確認）。完了条件: W-05、W-06、W-22、W-23
20. **入口と旅行の選択** … `shared/browser/selected-trip-store.ts`、`app/page.tsx`の遷移、ログアウトで消す。完了条件: W-01〜W-04
21. **画面** … `/trips`（15のページ版・19）、`/trips/new`（v3に無い。設計書「v3に無い画面の組み方」）、旅行ヘッダーとメニュー（16〜18）。完了条件: 画面を開いて主要な状態が描画されるテスト

### M2-d: しおり・予定の画面

22. **features/plans** … api、model（しおり・予定・追加・更新・移動・取りやめ）、ui（予定カード、詳細、フォーム、日の移動、取りやめの確認）。完了条件: W-18〜W-21
23. **画面** … しおり（08、日付バー、URLのdate）、予定の詳細（09と操作）、予定の追加・編集（v3に無い）。invalidateは設計書「取得状態」と07 §11。完了条件: W-16、W-17
24. **下部のタブ** … 「しおり」だけ（差分2）。完了条件: 旅行の画面でタブが1つだけ出る

### M2-e: 手動確認

25. **手動確認** … Claude Codeが手順を用意し、ユーザーとM-01〜M-06を行う。M-05のスクリーンショットはClaude Codeが撮り（ブラウザの375幅）、ユーザーに見てもらう。直しはL1のIssueにする。結果をログに記録する

## 依存関係

- 1 → 2 → 3（a1）→ 4 → 5〜8（a2）→ 9〜11（a3）→ 16〜18（b）
- 12〜15（c1）は5（契約と生成物）に依存する。a3・bとは独立
- 19〜21（c2）はa3（旅行のAPI）とc1に依存する。22〜24（d）はbとc2に依存する
- 4のスパイクで設計と違う結果が出たら、Devinは止まって報告し、Claude Codeが設計書を直してユーザーに伝えてから次へ進む

## 委譲の仕方

- Issueは`.github/ISSUE_TEMPLATE/devin-task.md`の形で、Claude Codeが1 PRずつ作る。「読む資料」に設計書・試験計画の観点ID・この計画の手順番号を書く。
- 記録は`node .claude/scripts/delegation.mjs init <Issue> --model swe-2-<effort> --level 3`。レビューと自動投稿は`review-devin-pr`どおり。
- L3なので、DevinのPRの中で設計と違う実装が要る場合は、Devinは止まって報告する（devin-workflow §1）。レビューでは設計書の節ごとに突き合わせる。
- 認証・入力・ログを触るa2・a3・bは、レビューでsecurity観点（他人の旅行が読めないか、403 / 404で存在が漏れないか、receiptに秘密が入らないか）を必ず見る。疑わしければworktreeで実際に動かす。

## テスト計画

docs/tests/m2-trips-and-plans.mdのとおり。配置は次のとおり。

- `apps/api/tests/domain/{local-date,local-time,bounded-text,trip,plan}.test.ts`
- `apps/api/tests/http/{etag,idempotency-key,api-error-filter,zod-body-pipe}.test.ts`、`tests/idempotency/command-receipt.test.ts`
- `apps/api/tests/usecase/planning/*.test.ts`（インメモリの文脈）
- `apps/api/tests/db/{planning-schema,trips-http,plans-http}.db.test.ts`（Testcontainers。app_runtimeで接続）
- `apps/api/tests/support/`（fixtureのセッション・旅行の作成。本番コードからimportしない）
- `apps/web/tests/{mutation-request,save-state,state-views,entry,trips-screen,trip-form,itinerary-screen,plan-form,plan-detail}.test.tsx`

## リスク

| ID | リスク | 対策 |
|---|---|---|
| R-1 | OrvalのAPI用Zodがstrict / maxLengthの除外に対応しない | 手順4のスパイクで先に確かめる。だめなら生成物を包むPipe側で未知のキーの検出と長さの除外を行う案をClaude Codeが設計書に足す |
| R-2 | 相互参照FKをgenerateが扱えない | 手順1でカスタムmigrationに移す |
| R-3 | 同時実行のテストが不安定 | ロックの待ちを`pg_locks`で確かめてから次の文を流す。時間待ちにしない |
| R-4 | DevinがL3の設計を独断で変える | Issueに「設計と違う実装が要るなら止まる」を書き、レビューで設計書の節と突き合わせる |
| R-5 | v3に無い画面の見た目が期待と違う | M2-eでスクリーンショットを確認し、L1のIssueで直す |
| R-6 | 委譲が7回続き、時間がかかる | c1はクラウドのDevinでa3と並行できる（ユーザーが指示したときだけ） |

## ロールバック方法

- 本番環境・本番データが無いため、各PRのrevertで戻せる。
- migration 0002〜0004は、本番へ適用する前ならフォルダごと作り直してよい（ADR-0003）。ローカル開発DBは`docker compose down -v`で作り直し、M1の初期登録をやり直す（ユーザーに確認してから）。

## ドキュメント更新対象

- 設計書: 手順4のスパイクの結果（「リスク」）、相互参照FKの扱い
- README: M2の画面の入口と、ローカルでの確認手順（M-01〜M-06）
- AGENTS.mdの「現在の状態」: M2の完了時に更新
- ADR: 変更なしの見込み（スパイクで方式が変わればADR-0004を更新）
