# 実装計画: records-and-home（記録と4画面の完成）

- 前提となる設計書: docs/designs/records-and-home.md（2026-10-04承認、PR #139）
- 試験計画: docs/tests/records-and-home.md
- レベル: L3
- 実装ルート: Devinに委譲する（論点の記録「実装を誰がどう進めるか」の答え。前回の支払い・精算と同じ進め方）。起動はクラウド。effortは、同時実行とスナップショットを含むPRはmax、ほかはhigh
- 判断理由: 前回と同じくらいの大きさ（API6つ・migration1つ・画面7か所・端末に残す仕組みの広げ方・E2E4つ）で、並行できるPRが多い

## この文書の読み方

- **PRの名前**（「達成・予約のAPI」など）は、この計画の中での呼び名。Issueの題とPRの説明にもこの名前を使う。
- **手順の番号**（1〜22）は、下の「実装手順」の番号。
- 観点の番号（RU-・RD-・RW-・RE-・RM-）は試験計画の番号。要件の番号（F-・E-）は要件定義の番号。

## PRの分け方

| PR                         | 範囲                                                                                                                   | 手順   | 観点                       | effort                                     | マージ後にできること                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------- | ------------------------------------------ | -------------------------------------------------- |
| DBの権限と契約             | 達成・予約の表の書き込みの権限、達成・予約・記録の一覧・ホームの契約と生成物                                           | 1〜3   | RD-01                      | high                                       | APIと画面の型がそろい、達成・予約の表に書ける      |
| 達成・予約のAPI            | 付ける・取り消すの4つ、付けられるかの決まり、予定の詳細が返す有効な記録の確認                                          | 4〜7   | RU-01〜RU-03、RD-02〜RD-09 | max                                        | APIで達成・予約を付けて取り消せる                  |
| 記録の一覧のAPI            | 記録の一覧、並びとカーソル、1件に絞る表示                                                                              | 8〜9   | RU-04、RD-10〜RD-14        | high                                       | APIで記録を新しい順に読める                        |
| ホームのAPI                | ホーム、スナップショットとセーブポイント、最近の記録と精算の欄のポート                                                 | 10〜12 | RU-05〜RU-06、RD-15〜RD-19 | max                                        | APIでホームを読める                                |
| webの共通部品              | 共通の下のタブ、端末に残す仕組みの経路の追加と旅行の作成、旅行・予定の画面の送り直しの確認                             | 13〜15 | RU-07、RW-01〜RW-04        | high                                       | 全画面に4つのタブ。旅行・予定の保存も送り直せる    |
| 記録の画面                 | 記録の一覧、達成・予約の小さな詳細、取り消しの確認、支払いの詳細と訂正、予定の詳細の達成・予約のボタンと関連する支払い | 16〜18 | RW-05〜RW-11・RW-19・RW-20 | high                                       | 画面から達成・予約を付けて取り消し、記録を見返せる |
| ホームの画面               | ホームの4つの表示の種類と欄ごとの失敗、ログインのあとの行き先                                                          | 19〜20 | RW-12〜RW-15               | high                                       | ログインするとホームが開く                         |
| 受け渡しの確認の追加と了承 | 追加の案内、取り消しの了承と作り直し                                                                                   | 21     | RU-08、RW-16〜RW-18        | high                                       | 確認のあとに支払いが変わっても記録できる           |
| E2Eと手動確認              | E2Eの4つ、手動確認                                                                                                     | 22     | RE-01〜RE-04、RM-01〜RM-02 | high（E2E）・Claude Codeとユーザー（手動） | 記録と4画面の完成                                  |

委譲は4つの波に分けて並行で進める。全部クラウドで起動する。

| 波  | 同時に進めるPR                                                   | 始める条件                                                                        |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | DBの権限と契約 ／ webの共通部品 ／ 受け渡しの確認の追加と了承    | すぐ                                                                              |
| 2   | 達成・予約のAPI ／ 記録の一覧のAPI ／ 記録の画面 ／ ホームの画面 | DBの権限と契約がマージされたら。画面の2つはwebの共通部品のマージも待つ            |
| 3   | ホームのAPI                                                      | 記録の一覧のAPIがマージされたら（最近の記録のポートが記録の一覧の読み取りを使う） |
| 4   | E2Eと手動確認                                                    | 波1〜3がすべてマージされたら                                                      |

- 画面の試験はAPIを模擬で動かすので、画面のPRはAPIの実装を待たない（契約があればよい）。
- 受け渡しの確認の追加と了承は、今ある精算・残額のAPIだけを使うので、契約のPRを待たない。
- 同じファイルを触るPR（`package-lock.json`、`orval.config.ts`、しおり・精算の画面の下部、`pending-requests.ts`）は、あとでマージする側で衝突を解消する。マージの順番はClaude Codeが案内する。
- L3のAPIのPR（達成・予約・記録の一覧・ホーム）は、最初のレビューでreviewerとsecurity-reviewerを並行して動かす（試行中のやり方）。

## 変更対象ファイル

| path                                                                                           | なぜ変えるか                                                                                                  |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/openapi/planning.json`・`trips.json`                                       | 達成・予約・記録の一覧・ホームの契約。`Error.existingRecordId`と`Schedule.achievedCount`                      |
| `orval.config.ts`と生成物                                                                      | 契約を足したので作り直す                                                                                      |
| `apps/api/src/common/http/api-error.ts`                                                        | `RECORD_ALREADY_ACTIVE`・`RECORD_NOT_FOUND`と`existingRecordId`                                               |
| `apps/api/src/common/http/api-error.filter.ts`                                                 | 詳細の`existingRecordId`を応答の本文に写す（今は`existingSettlementId`と`changedPaymentIds`だけを写している） |
| `packages/contracts/src/error.ts`                                                              | フィルターが使う手書きのエラーの型に`existingRecordId`を足す                                                  |
| `apps/api/src/modules/record/record.module.ts`・`planning/planning.module.ts`・`composition/*` | 新しいコントローラーとポートの配線                                                                            |
| `apps/web/src/screens/itinerary/itinerary-screen.tsx`・`settlement/settlement-screen.tsx`      | 画面ごとの`<nav>`を共通の下のタブに置き換える                                                                 |
| `apps/web/src/screens/plan-detail/plan-detail-screen.tsx`                                      | 達成・予約のボタンと関連する支払い                                                                            |
| `apps/web/src/screens/settlement-preview/settlement-preview-screen.tsx`                        | 追加の案内と取り消しの了承                                                                                    |
| `apps/web/src/screens/payment-form/payment-form-screen.tsx`                                    | 訂正のときに取り消した内容を入れておく                                                                        |
| `apps/web/src/screens/entry/entry-screen.tsx`                                                  | ログインのあとにホームを開く                                                                                  |
| `apps/web/src/shared/browser/pending-requests.ts`                                              | 送り直してよい経路と、旅行の作成（`new-trip`）                                                                |
| 旅行・予定の書き込みの画面と`features/trips`・`features/plans`のmodel                          | 送る直前に端末に残し、送り直しの確認を出す                                                                    |
| 予定の詳細・記録の一覧・小さな詳細の達成・予約の操作（`features/records`のmodel）              | 達成・予約の付ける・取り消すも、送る直前に端末に残し、送り直しの確認を出す                                    |

## 新規作成ファイル

設計書「変更後構成」のとおり（`drizzle/0008_plan_event_grants.sql`、`modules/record`の達成・予約と記録の一覧、`modules/planning`のホーム、`features/records`、`features/trips/ui/trip-tab-bar.tsx`、`screens/{home,records,payment-detail}`、画面のルート、E2Eの試験）。

## 実装手順

### DBの権限と契約

1. `drizzle/0008_plan_event_grants.sql`（`npm run db:check`が通る形で足す。`plan_events`・`plan_event_cancellations`にINSERT、`active_plan_events`にINSERT・DELETE）。完了条件: RD-01が通る。
2. 設計資料の`openapi.planning.json`・`openapi.trips.json`から、達成・予約・記録の一覧・ホームを`packages/contracts/openapi/`に取り込む。`Error`に任意の`existingRecordId`（uuid）、`Schedule`に`achievedCount`（0以上の整数、必須）を足す。完了条件: `npm run type-check -w @tomotabi/contracts`が通る。
3. `npm run api:generate`で生成物を作り直す。完了条件: `npm run api:check`と`npm run type-check`が通る。

### 達成・予約のAPI

4. `modules/record/domain/plan-event.ts`（種類ごとに付けられる予定の種類と、取りやめた予定への可否）。完了条件: RU-01。
5. `PlanEligibilityPort`とその実装（予定の行をFOR NO KEY UPDATEで取り、種類・取りやめ・所属を返す）、`PlanEventRepository`とDrizzleの実装。完了条件: 旅行 → 予定の順でロックする。
6. 付ける・取り消すのUseCase（達成と予約で共有）とコントローラー4つ。受領・Idempotency-Key・`ApiError`は支払いと同じ流れ。完了条件: RD-02〜RD-07。
   `RECORD_ALREADY_ACTIVE`の今ある記録のIDは、`api-error.ts`の詳細から`api-error.filter.ts`で本文の`existingRecordId`に写し、`packages/contracts/src/error.ts`の型にも足す。完了条件: RD-04で409の本文に`existingRecordId`が入る。
7. 同時実行の試験（種類の変更と達成、取りやめと達成を2つの接続で）。完了条件: RD-08・RD-09を10回続けて通す。

### 記録の一覧のAPI

8. `pg-records-read.ts`（UNION ALLで種類・ID・登録日時・誰が・予定のID・元の記録のIDを並べ、中身は種類ごとにまとめて読む）。並びは登録日時の新しい順、同じ日時なら種類・ID。完了条件: RD-10・RD-11。
9. カーソル（登録日時・種類・IDに旅行のIDと絞り込みの条件を結びつける）、`recordId`の1件に絞る表示、条件の組み合わせの400。完了条件: RU-04、RD-12〜RD-14。

### ホームのAPI

10. `pg-home-read.ts`（REPEATABLE READ・READ ONLY。欄ごとのセーブポイント。欄は順に読む）。完了条件: RD-15。
11. `HomeRecordsPort`（記録の一覧の読み取りを最大3件で）と`HomeBalancePort`（settlementの残額の計算を使う）をcompositionでつなぐ。完了条件: ホーム専用の金額の計算が無い。
12. `GetHomeUseCase`（表示の種類、予定の欄の並びと`achievedCount`、欄ごとの`unavailable`）とコントローラー。完了条件: RU-05・RU-06、RD-16〜RD-19。

### webの共通部品

13. `features/trips/ui/trip-tab-bar.tsx`（ホーム・しおり・記録・精算と「支払いを記録」）。しおり・精算の画面の`<nav>`を置き換える。完了条件: RW-01、しおり・精算の今の試験が通る。
14. `pending-requests.ts`に旅行・予定・達成・予約の経路と、旅行の作成（`new-trip`）を足す。完了条件: RU-07。
15. 旅行・予定の書き込み（作成・名前の変更・期間の変更・開始・終了、予定の追加・編集・日の移動・取りやめ）で、送る直前に端末に残し、画面に送り直しの確認を出す。完了条件: RW-02〜RW-04。

### 記録の画面

16. `features/records`（api・model）と`/trips/{tripId}/records`。行・取り消しの行・絞り込み（横にずらす）・読み足しと再試行・0件。完了条件: RW-05〜RW-07。
17. 達成・予約の小さな詳細（`shared/ui/sheet.tsx`）、取り消しの確認、`/trips/{tripId}/payments/{paymentId}`の支払いの詳細と訂正。完了条件: RW-08〜RW-10。
    達成・予約の取り消しは、送る直前に端末に残し、小さな詳細と記録の一覧に送り直しの確認を出す（手順15と同じ仕組み）。完了条件: RW-19。
18. 予定の詳細の達成・予約のボタン、有効な記録の行のリンク、関連する支払い（最大3件と「記録で見る」）。409を受けたら予定を取り直す。完了条件: RW-11。
    達成・予約を付けるときは、送る直前に端末に残し、予定の詳細に送り直しの確認を出す。予約のボタンと小さな詳細に「このアプリの中の記録です。お店の予約は変わりません」を出す（F-08）。完了条件: RW-11・RW-19・RW-20。

### ホームの画面

19. `/trips/{tripId}/home`。4つの表示の種類、予定の欄（並びと「達成済み N 件」「ほか N 件」）、精算の欄（対象0件・0円・失敗）、最近の記録、期間が過ぎたときの帯。完了条件: RW-12〜RW-14。
20. ログインのあと前回の旅行のホームを開く。完了条件: RW-15。

### 受け渡しの確認の追加と了承

21. 追加の案内（状態が`ready`・`cancelled_items_ack_required`のときだけ、残額の対象のうち確認に無い支払いを数える）、取り消しの了承（明細ごとのチェック、作り直し、取り直しで一覧が変わったらチェックを外す）。0円の確認では了承を出さない。完了条件: RU-08、RW-16〜RW-18。

### E2Eと手動確認

22. E2EのRE-01〜RE-04（`e2e/tests/`）。手動確認RM-01・RM-02はClaude Codeが手順を用意し、375幅のスクリーンショットをユーザーに見てもらう。

## 依存関係

- DBの権限と契約 → 達成・予約のAPI ／ 記録の一覧のAPI → ホームのAPI
- webの共通部品は、どのPRにも依存しない（今ある経路と画面だけを触る）
- 記録の画面・ホームの画面は、DBの権限と契約（型）とwebの共通部品に依存する。APIの実装には依存しない
- 受け渡しの確認の追加と了承は、どのPRにも依存しない
- E2Eは全部に依存する

## 委譲の仕方

- Issueは`.github/ISSUE_TEMPLATE/devin-task.md`の形で、PRごとに1つ作る。「読む資料」に設計書の節、試験計画の観点、この計画の手順を書き、Issueの本文でも番号には中身を添える。
- 記録は`node .claude/scripts/delegation.mjs init <Issue> --model swe-2-<effort> --level 3`。起動後は`devin-stall-watch.mjs`で見張る。
- 設計と違う実装が要るときは、Devinは止まって報告する（devin-workflow）。
- 同時実行とスナップショットのPR（達成・予約のAPI、ホームのAPI）は、詳細設計「予定・達成・予約」の排他と「旅行の作成・選択・開始／終了とホーム」の失敗の節と突き合わせてレビューする。

## テスト計画

試験計画のとおり。配置は各workspaceの`tests/`に`src/`をミラーする（`apps/api/tests/domain/record/*`、`tests/db/records-*.db.test.ts`、`apps/web/tests/*`、`e2e/tests/*`）。

## リスク

| リスク                                                                 | 対策                                                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 下のタブを共通にすると、しおりと精算の画面の試験が崩れる               | webの共通部品のPRで、しおり・精算の画面の試験を一緒に直す                |
| 同時実行の不安定な試験                                                 | 待ちを確かめてから進める形（予定の同時実行の試験と同じ）。10回続けて流す |
| ホームのセーブポイントの扱いの誤りで、1つの欄の失敗が全体を止める      | 欄のクエリを失敗させる偽の実装で、ほかの欄が返ることを試す（RD-18）      |
| 並行するPRの衝突（`pending-requests.ts`・生成物・`package-lock.json`） | 衝突しやすいファイルを波1にまとめ、マージの順番をClaude Codeが案内する   |
| PRが大きくなる                                                         | 9つに分けた。1つのPRで収まらないときは止まって報告する                   |

## ロールバック方法

PRごとにrevertする。migrationは権限の`GRANT`だけなので、`REVOKE`で戻せる。

## ドキュメント更新対象

- `docs/glossary.md`（足した用語があれば）
- README（APIの一覧に達成・予約・記録の一覧・ホーム）
