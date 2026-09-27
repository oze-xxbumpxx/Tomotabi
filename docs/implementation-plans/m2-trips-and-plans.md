# 実装計画: m2-trips-and-plans

- 前提となる設計書: docs/designs/m2-trips-and-plans.md（2026-09-27 承認）、docs/requirements/m2-trips-and-plans.md、ADR-0004、ADR-0003
- 試験計画: docs/tests/m2-trips-and-plans.md
- レベル: L3
- 実装ルート: できるだけ Devin に委譲する（2026-09-27 ユーザー判断）。Claude Code は Issue の作成・レビュー・手動確認の準備・スクリーンショットの確認依頼を担う
- 判断理由: 変更量が大きく、共通部品・API・画面で層が分かれるため、7 つの PR に分ける。各 PR は Devin の 1 セッションで終わる大きさにし、試験計画の観点 ID で完了を判定できるようにする

## PR の分け方

| PR | 範囲 | 手順 | 観点 | Devin の effort | マージ後にできること |
|---|---|---|---|---|---|
| M2-a1 | DB の土台 | 1〜3 | D-01〜D-10 | high | 8 表・トリガー・GRANT がそろい、権限テストが CI で回る |
| M2-a2 | 書き込みの共通部品と契約 | 4〜8 | U-01〜U-07、U-12〜U-16 | max | エラー形式・ETag・Idempotency・Zod の Pipe・Domain の値型、trips.json / planning.json と生成物がそろう |
| M2-a3 | 旅行の API | 9〜11 | U-08、U-17〜U-19、T-01〜T-18 | max | 旅行の作成・一覧・取得・名前・期間・開始・終了が実 DB で動く |
| M2-c1 | web の基盤 | 12〜15 | W-07〜W-15、W-24、W-25 | high | TanStack Query・保存状態・共通の状態表示・シート等の部品がそろう（画面はまだ） |
| M2-b | 予定の API としおり | 16〜18 | U-09〜U-11、U-20、P-01〜P-15 | max | 予定の CRUD 相当としおりが実 DB で動く |
| M2-c2 | 旅行の画面と入口 | 19〜21 | W-01〜W-06、W-22、W-23 | high | ログイン後に旅行を作り・選び・開始 / 終了できる |
| M2-d | しおり・予定の画面 | 22〜24 | W-16〜W-21 | high | しおりで予定の追加・編集・移動・取りやめができる |
| M2-e | 手動確認 | 25 | M-01〜M-06 | —（Claude Code とユーザー） | M2 の完了 |

委譲の順序は **a1 → a2 → a3 → c1 → b → c2 → d → e**。ローカルの Devin は同じクローンで 2 つ同時に動かさないため、1 つずつ進める（前の PR のマージ後に次の Issue を渡す）。c1 は a2（契約と生成物）だけに依存するので、a3 と並べたい場合はクラウドの Devin で並行できる（ユーザーの指示があるときだけ）。

各 PR は単独で品質ゲート（lint / type-check / test / test:api-db / build / api:check）を通す。

## 変更対象ファイル

| path | なぜ変えるか |
|---|---|
| `apps/api/src/app.module.ts` | PlanningModule、composition、APP_FILTER（ApiErrorFilter）を登録 |
| `apps/api/package.json` | `zod` を dependencies に追加（ADR-0004） |
| `apps/api/src/infrastructure/database/schema/index`（drizzle.config の schema 指定） | planning・record・infra のスキーマを追加 |
| `orval.config.ts` | trips.json・planning.json の web 用 client / zod と api 用 zod（`strict`、入力 body の `maxLength` を外す transformer）を追加 |
| `package.json`（ルート） | `api:check` の差分確認に `apps/api/src/generated` を足す |
| `apps/web/package.json` | `@tanstack/react-query` を追加 |
| `apps/web/src/app/layout.tsx` | providers を挟む |
| `apps/web/src/app/page.tsx`、`screens/home/*` | 最小ホームを入口（F-23）に置き換える。表示名とログアウトはメニューへ移す。foundation の検証パネルへの導線を外す（未決事項 2） |
| `apps/web/src/shared/api/{api-failure,http-client}.ts` | code と ETag（設計書「ApiFailure の拡張」） |
| `apps/web/src/features/auth/model/use-sign-out.ts` | ログアウト成功時に選択中の旅行の保存値を消す |
| `apps/web/src/app/globals.css` | シート・ダイアログ・日付バー・状態表示のスタイル（v3 のトークンだけを使う） |

## 新規作成ファイル

設計書「変更後構成」のとおり。主なもの:

| path | 役割 |
|---|---|
| `apps/api/drizzle/0002_*.sql`・`0003_*.sql`・`0004_*.sql` | 表（generate）、トリガー（custom）、GRANT（custom） |
| `apps/api/src/infrastructure/database/schema/{planning,record,infra}.ts` | Drizzle スキーマ |
| `apps/api/src/common/domain/{local-date,local-time,bounded-text}.ts` | 値型 |
| `apps/api/src/common/http/*`、`common/idempotency/*` | 書き込みの共通部品 |
| `apps/api/src/adapter/clock/clock.ts`、`infrastructure/clock/system-clock.ts` | 時刻の IF と実装 |
| `apps/api/src/modules/planning/**` | 旅行・予定のモジュール |
| `apps/api/src/modules/record/infrastructure/pg-record-history.query.ts` | 履歴の照会 |
| `apps/api/src/modules/identity/infrastructure/pg-participants.query.ts` | allowlist の二人の照会 |
| `apps/api/src/composition/planning-composition.module.ts` | port と照会実装の配線 |
| `apps/api/src/generated/*.zod.ts` | API 用の Zod（生成物） |
| `packages/contracts/openapi/{trips,planning}.json`、`src/{trip,plan}.ts` | 契約と wire 型 |
| `apps/web/src/app/providers.tsx`、`app/trips/**` | ルート |
| `apps/web/src/screens/{trips,itinerary,plan-detail,plan-form}/*` | 画面 |
| `apps/web/src/features/{trips,plans}/{ui,model,api}/*`、`index.ts` | 機能 |
| `apps/web/src/shared/api/{mutation-request,query-client}.ts`、`shared/lib/*`、`shared/ui/*`、`shared/browser/selected-trip-store.ts` | 共通 |
| テスト一式 | 下の「テスト計画」の配置 |

## 実装手順

### M2-a1: DB の土台

1. **スキーマ定義** … `schema/planning.ts`・`record.ts`・`infra.ts`。設計書「DB 設計 > 表」と参照 SQL（03・04・01）を移す。trips と trip_participants の相互参照 FK（started_by / finished_by）が generate で期待どおりに出なければ、カスタム migration に移す。完了条件: `db:generate` が差分なしで再現し、`db:check` が通る
2. **カスタム migration** … `0003`: `infra.reject_history_mutation()` と 2 表のトリガー。`0004`: スキーマの USAGE と、設計書「GRANT」の表どおりの権限（DELETE なし、UPDATE は列指定）。完了条件: 空 DB と M1 適用済み DB の両方に `db:migrate` が通り、2 回目は何もしない
3. **DB テスト** … `tests/db/planning-schema.db.test.ts`。D-01〜D-10。D-10 は「allowlist を FOR SHARE できない」ことの固定（設計の差分 1 の根拠）。完了条件: `test:api-db` が成功

### M2-a2: 書き込みの共通部品と契約

4. **Orval の確認（スパイク）** … trips.json を仮に置き、API 用の Zod 出力で次を確かめる。`override.zod.strict.body` で `.strict()` が出るか、input transformer で入力 body の `maxLength` だけを外せるか（応答の型には残す）、`format: date` の扱い。結果を設計書の「リスク」に書き戻す。想定と違えば Claude Code に戻す（Devin は設計を変えない）。完了条件: 3 点の結果が PR の説明にある
5. **契約** … 詳細設計の openapi.trips.json・openapi.planning.json から M2 の 13 操作を `packages/contracts/openapi/trips.json`・`planning.json` に移す。getTrip は trips.json に 1 つだけ。home・achievements・bookings・records は移さない。Error スキーマは `{ code, message, requestId, retryable }`。`src/trip.ts`・`plan.ts` に wire 型。完了条件: `api:generate` で web 用・api 用の生成物ができ、`api:check` が差分なし
6. **Domain の値型** … `local-date`・`local-time`・`bounded-text`。完了条件: U-01〜U-07
7. **HTTP の共通部品** … `api-error.ts`・`api-error.filter.ts`（APP_FILTER。requestId は pino-http の要求 id）、`etag.ts`、`idempotency-key.ts`、`zod-body.pipe.ts`、`command-receipt.ts`（request_hash）。M1 の Guard の例外も新しい形になることを確かめる。完了条件: U-12〜U-16。M1 の既存テストがすべて通る
8. **Clock** … `adapter/clock/clock.ts`（now と「日本時間の今日」）、`system-clock.ts`。完了条件: U-20 の日付計算部分（日本時間の境界）が通る

### M2-a3: 旅行の API

9. **Trip と UnitOfWork** … `domain/trip.ts`・`trip-period.ts`、`PlanningWorkContext`、`PgPlanningUnitOfWork`、`drizzle-trip.repository.ts`、`pg-participants.query.ts`（ロックなし。差分 1）、receipt の読み書き、guard の INSERT。完了条件: U-08
10. **UseCase と Controller** … create / list / get / rename / change-period（予定の日付の検証は plans 表を読むだけ。M2-b の前でも予定は表に直接入れてテストできる）/ start / finish。設計書「書き込みの共通の流れ」の順序。同じキーの同時作成は PK 違反 → ロールバック → 新しいトランザクションで読み直し。完了条件: U-17〜U-19
11. **HTTP + DB テスト** … `tests/db/trips-http.db.test.ts`。T-01〜T-18。T-03 は guard の INSERT で失敗させる注入（テスト用の Repository の差し替え。本番コードに注入口を足さない）、T-06 は 2 接続。完了条件: `test:api-db` が成功

### M2-c1: web の基盤

12. **TanStack Query** … `app/providers.tsx`、`shared/api/query-client.ts`（設計書の既定値）。Next.js 16 / React 19 で動くことを最初に確かめる。完了条件: 既存の web テストが通る
13. **ApiFailure と http-client の拡張** … code（許可リスト）と ETag。message・requestId は取り出さない。完了条件: W-25
14. **保存の要求と状態** … `mutation-request.ts` と、feature の model が使う保存状態の hook（editing / saving / succeeded / rejected / unknown / session-expired / conflict）。完了条件: W-07〜W-12、W-24（テスト用の小さなフォームで確かめる）
15. **共通の部品と状態表示** … `shared/ui` の sheet・dialog・field・segmented・toast、`shared/ui/state/*`（v1 の読み込み・更新中・更新できていません、C-1〜C-5）。v3 の README と `Tomotabi 画面一式 v3.dc.html` の 20〜24 を見て作る。完了条件: W-13〜W-15

### M2-b: 予定の API としおり

16. **Plan と照会** … `domain/plan.ts`・`plan-kind.ts`、`drizzle-plan.repository.ts`、`pg-record-history.query.ts`（履歴の有無と有効な達成・予約）、`pg-planning-read.ts`（しおりと予定詳細。有効な記録を LEFT JOIN）、composition の配線。完了条件: U-09〜U-11
17. **UseCase と Controller** … get-itinerary（日付の既定は Clock）、create / get / update / move / cancel。ロック順序は設計書の表どおり。完了条件: U-20、`tests/db/plans-http.db.test.ts` の P-01〜P-12
18. **同時実行のテスト** … P-13〜P-15 を 2 接続で。完了条件: `test:api-db` が成功（10 回続けて流して不安定にならないことを PR の説明に書く）

### M2-c2: 旅行の画面と入口

19. **features/trips** … api（生成関数 + `callApi`）、model（一覧・取得・作成・名前・期間・開始・終了）、ui（旅行カード、作成フォーム、メニュー、終了の確認）。完了条件: W-05、W-06、W-22、W-23
20. **入口と旅行の選択** … `shared/browser/selected-trip-store.ts`、`app/page.tsx` の遷移、ログアウトで消す。完了条件: W-01〜W-04
21. **画面** … `/trips`（15 のページ版・19）、`/trips/new`（v3 に無い。設計書「v3 に無い画面の組み方」）、旅行ヘッダーとメニュー（16〜18）。完了条件: 画面を開いて主要な状態が描画されるテスト

### M2-d: しおり・予定の画面

22. **features/plans** … api、model（しおり・予定・追加・更新・移動・取りやめ）、ui（予定カード、詳細、フォーム、日の移動、取りやめの確認）。完了条件: W-18〜W-21
23. **画面** … しおり（08、日付バー、URL の date）、予定の詳細（09 と操作）、予定の追加・編集（v3 に無い）。invalidate は設計書「取得状態」と 07 §11。完了条件: W-16、W-17
24. **下部のタブ** … 「しおり」だけ（差分 2）。完了条件: 旅行の画面でタブが 1 つだけ出る

### M2-e: 手動確認

25. **手動確認** … Claude Code が手順を用意し、ユーザーと M-01〜M-06 を行う。M-05 のスクリーンショットは Claude Code が撮り（ブラウザの 375 幅）、ユーザーに見てもらう。直しは L1 の Issue にする。結果をログに記録する

## 依存関係

- 1 → 2 → 3（a1）→ 4 → 5〜8（a2）→ 9〜11（a3）→ 16〜18（b）
- 12〜15（c1）は 5（契約と生成物）に依存する。a3・b とは独立
- 19〜21（c2）は a3（旅行の API）と c1 に依存する。22〜24（d）は b と c2 に依存する
- 4 のスパイクで設計と違う結果が出たら、Devin は止まって報告し、Claude Code が設計書を直してユーザーに伝えてから次へ進む

## 委譲の仕方

- Issue は `.github/ISSUE_TEMPLATE/devin-task.md` の形で、Claude Code が 1 PR ずつ作る。「読む資料」に設計書・試験計画の観点 ID・この計画の手順番号を書く。
- 記録は `node .claude/scripts/delegation.mjs init <Issue> --model swe-2-<effort> --level 3`。レビューと自動投稿は `review-devin-pr` どおり。
- L3 なので、Devin の PR の中で設計と違う実装が要る場合は、Devin は止まって報告する（devin-workflow §1）。レビューでは設計書の節ごとに突き合わせる。
- 認証・入力・ログを触る a2・a3・b は、レビューで security 観点（他人の旅行が読めないか、403 / 404 で存在が漏れないか、receipt に秘密が入らないか）を必ず見る。疑わしければ worktree で実際に動かす。

## テスト計画

docs/tests/m2-trips-and-plans.md のとおり。配置は次のとおり。

- `apps/api/tests/domain/{local-date,local-time,bounded-text,trip,plan}.test.ts`
- `apps/api/tests/http/{etag,idempotency-key,api-error-filter,zod-body-pipe}.test.ts`、`tests/idempotency/command-receipt.test.ts`
- `apps/api/tests/usecase/planning/*.test.ts`（インメモリの文脈）
- `apps/api/tests/db/{planning-schema,trips-http,plans-http}.db.test.ts`（Testcontainers。app_runtime で接続）
- `apps/api/tests/support/`（fixture のセッション・旅行の作成。本番コードから import しない）
- `apps/web/tests/{mutation-request,save-state,state-views,entry,trips-screen,trip-form,itinerary-screen,plan-form,plan-detail}.test.tsx`

## リスク

| ID | リスク | 対策 |
|---|---|---|
| R-1 | Orval の API 用 Zod が strict / maxLength の除外に対応しない | 手順 4 のスパイクで先に確かめる。だめなら生成物を包む Pipe 側で未知のキーの検出と長さの除外を行う案を Claude Code が設計書に足す |
| R-2 | 相互参照 FK を generate が扱えない | 手順 1 でカスタム migration に移す |
| R-3 | 同時実行のテストが不安定 | ロックの待ちを `pg_locks` で確かめてから次の文を流す。時間待ちにしない |
| R-4 | Devin が L3 の設計を独断で変える | Issue に「設計と違う実装が要るなら止まる」を書き、レビューで設計書の節と突き合わせる |
| R-5 | v3 に無い画面の見た目が期待と違う | M2-e でスクリーンショットを確認し、L1 の Issue で直す |
| R-6 | 委譲が 7 回続き、時間がかかる | c1 はクラウドの Devin で a3 と並行できる（ユーザーが指示したときだけ） |

## ロールバック方法

- 本番環境・本番データが無いため、各 PR の revert で戻せる。
- migration 0002〜0004 は、本番へ適用する前ならフォルダごと作り直してよい（ADR-0003）。ローカル開発 DB は `docker compose down -v` で作り直し、M1 の初期登録をやり直す（ユーザーに確認してから）。

## ドキュメント更新対象

- 設計書: 手順 4 のスパイクの結果（「リスク」）、相互参照 FK の扱い
- README: M2 の画面の入口と、ローカルでの確認手順（M-01〜M-06）
- AGENTS.md の「現在の状態」: M2 の完了時に更新
- ADR: 変更なしの見込み（スパイクで方式が変われば ADR-0004 を更新）
