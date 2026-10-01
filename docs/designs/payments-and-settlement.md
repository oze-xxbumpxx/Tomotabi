# 設計書: payments-and-settlement（支払い・精算の中核）

- ステータス: confirmed（2026-10-02 ユーザー承認。PR #106 のマージ。未決事項 1〜3 は推奨どおり）
- レベル: L3
- 関連: docs/requirements/payments-and-settlement.md、ADR-0002（認証）、ADR-0003（DB のロールと migration）、ADR-0004（web の取得状態と API の入力検証）、ADR-0005（E2E）、ADR-0006（結果不明の要求を IndexedDB に残す。案）

## 背景

要件定義のとおり。旅行・予定の段階で作った書き込みの共通部品（ETag・Idempotency-Key・受領・エラー形式・旅行単位のロック・保存状態）と、E2E の土台の上に、支払いと精算を作る。正本は詳細設計「支払いと精算」「画面状態と入力操作」「テストと監視・CI」と、`sql/01_finance.sql`・`openapi.finance.json`。

## 目的

- 支払い・残額・受け渡しの確認・精算・取り消しの API と DB を、正本の業務規則どおりに作る。
- 金額は BigInt と bigint で扱い、履歴は追記だけ、対象の占有は同じトランザクションで保つ。
- 結果不明の要求を IndexedDB に残し、再読み込みをまたいで同じ要求で確かめられるようにする。

## 要件

要件定義の機能要件（F-01〜F-63）、異常系（E-01〜E-17）、境界条件、受け入れ条件。この設計書で F- や E- の番号を引くときは、要件定義のその行を指す。

用語（要件定義の「この文書の読み方」と同じ）:

- **参加者番号**は旅行の二人に振る固定の番号 0（ひなた）と 1（あおい）。DB の `slot`。
- **寄与**は支払い 1 件が貸し借りに与える量（参加者番号 1 の人から 0 の人へ渡す向きを正）。
- **guard の行**（`infra.trip_finance_guards`）は、旅行ごとに 1 行ある「お金の書き込みの順番待ちの札」。お金の書き込みは最初にこの行をロックするので、同じ旅行の書き込みは一列に並ぶ。精算の連番もここで払い出す。
- **占有**（`settlement.active_claims`）は、「どの支払いが、どの精算で済んでいるか」の今の状態の記録。同じ支払いを二つの精算に入れないために使う。
- **BASE と REVERSAL** は精算の明細の種類。BASE は支払いをそのまま精算すること（寄与 c）。REVERSAL は、精算済みの支払いがあとで取り消されたときの戻し（−c）。
- **指紋**は、受け渡しの確認を作った時点の、その支払いの精算と取り消しの履歴をまとめた短い値（sha256）。完了のときに作り直して比べ、違えば「対象が変わった」と分かる（金額が同じでも見分けられる）。
- **受領**（`infra.command_receipts`）は、同じ要求の再送を見分けるための保存の記録。同じキーで送り直すと、ここから元の結果を返す。

## 対象範囲

API（支払いの記録・取得・取り消し、残額、確認の作成・一覧・取得、精算の完了・一覧・取得・取り消し）、DB（`record.payments`・`record.payment_cancellations`、`settlement` スキーマ）、画面（支払いを記録・精算・受け渡しの確認・対象 0 件と 0 円）、下部のタブの「精算」と主ボタン、IndexedDB の保留中の要求、試験。

## 対象外

要件定義の「対象外」のとおり（取り消された対象の了承の画面、追加の案内の帯、記録一覧、支払いを取り消す確認、支払いの詳細、旅行・予定の IndexedDB 対応、通知、部分額の受け渡し）。

## 現状構成

- DB: `planning.trips`・`trip_participants`（参加者番号 0・1。列名は slot）、`infra.trip_finance_guards`（`next_settlement_sequence` 既定 1）、`infra.command_receipts`（`resource_type` は支払い・確認・精算の種類を既に含む）、`record.plan_events` など（達成・予約の土台）。
- API: `modules/planning`（旅行・予定。`trip-write-flow.ts`・`plan-write-flow.ts` が書き込みの共通の流れ）、`modules/record`（達成・予約の履歴の照会だけ）、`common/http/*`（ETag・Idempotency-Key・ZodBodyPipe・ApiErrorFilter）、`common/idempotency/command-receipt.ts`。
- web: `features/trips`・`features/plans`、`shared/api/*`（`callApi`・`mutation-request`・`save-state`）、`shared/ui/*`（シート・ダイアログ・状態表示）。下部のタブは「しおり」だけ。
- 契約: `packages/contracts/openapi/{trips,planning}.json`。財務の契約はまだ無い（正本の `openapi.finance.json` だけ）。

## 変更後構成

```text
packages/contracts/openapi/finance.json        # 正本 openapi.finance.json を元に、上限 9,999,999 円などを反映
apps/api/src/
  infrastructure/database/schema/record.ts     # payments・payment_cancellations を足す
  infrastructure/database/schema/settlement.ts # settlement スキーマ（previews・preview_items・settlements・items・cancellations・active_claims）
  common/domain/yen.ts                         # Yen（bigint の円。1〜9,999,999 の支払い額と、符号付きの合計を分ける）
  modules/record/                              # 支払い（書くのは record）
    domain/payment.ts                          # 負担額・寄与の計算（F-04・F-05）
    usecase/{create,get,cancel}-payment.usecase.ts
    controller/payments.controller.ts
    adapter/outbound/{payment.repository,finance-work-context}.ts
    infrastructure/drizzle-payment.repository.ts
  modules/settlement/                          # 残額・確認・精算（支払いはポート越しに読む）
    domain/{settlement-target,fingerprint,balance}.ts  # 対象の導出（F-11）・指紋（F-31）・残額
    usecase/{get-balance,create-preview,list-previews,get-preview,complete-settlement,list-settlements,get-settlement,cancel-settlement}.usecase.ts
    controller/{balance,previews,settlements}.controller.ts
    adapter/outbound/{payments-read.port,settlement.repository}.ts
    infrastructure/{pg-finance-unit-of-work,drizzle-settlement.repository,pg-payments-read}.ts
apps/api/drizzle/0005_finance_tables.sql       # 生成
apps/api/drizzle/0006_finance_triggers.sql     # 追記のみのトリガー（custom）
apps/api/drizzle/0007_finance_grants.sql       # app_runtime の権限（custom）
apps/web/src/
  features/payments/{api,model,ui}             # 支払いを記録
  features/settlement/{api,model,ui}           # 精算・受け渡しの確認
  shared/browser/pending-requests.ts           # IndexedDB の保留中の要求（ADR-0006）
  shared/lib/yen.ts                            # 円の文字列 ⇔ BigInt、表示（3 桁区切り）
  app/trips/[tripId]/payments/new/page.tsx     # 支払いを記録（シート）
  app/trips/[tripId]/settlement/page.tsx       # 精算
  app/trips/[tripId]/settlement/previews/[previewId]/page.tsx  # 受け渡しの確認
e2e/tests/{payment-and-settlement,unknown-payment}.spec.ts
```

- `record` は支払いを書き、`settlement` は `payments-read.port` で同じトランザクションの支払いを読む。`record` から `settlement` の業務処理を呼ばない（詳細設計「支払いと精算」の「境界と実装への制約」）。
- 財務の書き込みはすべて `PgFinanceUnitOfWork` の中で行い、最初に `trip_finance_guards` の行を `SELECT … FOR UPDATE` する。

## データフロー

### 書き込みの共通の流れ（財務）

```text
Guard（Origin → セッション → userId）
→ Controller: 形式の検証、Idempotency-Key の解析、request_hash
→ UseCase: FinanceUnitOfWork.run(ctx => {
     1. 旅行の参加者か（無い・参加していない → 403）
     2. trip_finance_guards を FOR UPDATE（旅行の財務を一列に並べる）
     3. receipt を (userId, operation, key) で探す（あり・一致 → 保存した結果、あり・不一致 → 409）
     4. ロックの後で対象を読み、業務規則で検証する
     5. 履歴・占有・受領を保存する
   })
→ COMMIT 後に応答
```

- 旅行・予定の書き込みは旅行行を、財務は guard の行をロックする。財務と予定を同じトランザクションで扱う処理は今回無い（将来は旅行 → 予定 → guard の順。旅行・予定の段階の決めごと）。
- 財務の資源は追記だけで変わらないので、ETag と If-Match は使わない（取り消しは別の記録）。

### 確認の作成

ロックの後で対象（要件 F-11: 対象の導出）と占有を読み、確認と明細（各明細に、その時点の指紋と支払いの取り消し状態）を同時に保存する。ロックは保存後すぐ外す。

### 精算の完了

ロック → receipt → 確認が旅行に属するか → 確認にすでに精算があれば、その精算が取り消し済みなら 409（新しい確認へ案内。E-10）、有効なら既存の精算を返す（要件 E-07: 同じ確認を二人が同時に完了）→ 今の対象を導出し、確認の明細ごとに指紋・取り消し状態を比べる → 一致なら連番を払い出し、精算・明細・占有・受領を保存。BASE の支払いだけが取り消されていて、了承の集合が今の取り消し済み BASE の集合と完全に一致すれば例外として許可（要件 F-32: 取り消された対象の例外）。それ以外の違いは 409。

### 精算の取り消し

ロック → receipt → 最新の有効な精算か（連番で）→ 取り消しを追記し、その精算の占有を消す → 受領。占有を先に消して別のトランザクションで取り消しを書く構成は禁止。

### 読み取り

残額・確認の検証は `REPEATABLE READ` の短い読み取りトランザクションで、1 つのスナップショットから組み立てる。

## API 設計

`packages/contracts/openapi/finance.json`（正本 `openapi.finance.json` の 11 操作）。すべて `/api` の下、Cookie 認証と Origin の検証は既存の Guard。応答は `Cache-Control: private, no-store`。

| Method | Path | 必須ヘッダー | 成功 | 主な失敗 |
| --- | --- | --- | --- | --- |
| POST | /trips/{tripId}/payments | Idempotency-Key | 201（再送は元の状態） | 400、403、409 IDEMPOTENCY_KEY_REUSED、422 |
| GET | /trips/{tripId}/payments/{id} | — | 200 | 403、404 |
| POST | /trips/{tripId}/payments/{id}/cancel | Idempotency-Key | 201（取り消し済みは 200 で既存） | 403、404、409 |
| GET | /trips/{tripId}/balance | — | 200 | 403 |
| POST | /trips/{tripId}/settlement-previews | Idempotency-Key | 201 | 403、409、422（対象なし） |
| GET | /trips/{tripId}/settlement-previews?status=pending&cursor= | — | 200（自分の未完了、新しい順） | 400、403 |
| GET | /trips/{tripId}/settlement-previews/{id} | — | 200（元の明細と今の検証結果） | 403、404 |
| POST | /trips/{tripId}/settlements | Idempotency-Key | 201 | 403、404、409（PREVIEW_CHANGED など）、422 |
| GET | /trips/{tripId}/settlements?cursor= | — | 200 | 400、403 |
| GET | /trips/{tripId}/settlements/{id} | — | 200 | 403、404 |
| POST | /trips/{tripId}/settlements/{id}/cancel | Idempotency-Key | 201（取り消し済みは 200 で既存） | 403、404、409 SETTLEMENT_NOT_LATEST |

- 円は 10 進の整数文字列（`"7001"`、符号付きは `"-3500"`）。Zod は文字列のパターンで形式を見て、範囲は Domain の `Yen` で 422 にする。
- 正本との差分: 支払い額の上限を 9,999,999 円にする（`maxLength` と `pattern` を合わせる）。
- 支払いの入力は払った人を `payerUserId`、分け方を参加者番号 0 の人の負担の割合で受ける（正本どおり）。
- エラーの code（詳細設計「支払いと精算」の「API 契約案」に、旅行・予定の段階の共通の code を合わせる）: PREVIEW_CHANGED、CANCELLED_ITEMS_ACK_REQUIRED、TARGET_ALREADY_SETTLED、TARGET_PARTIALLY_SETTLED、SETTLEMENT_NOT_LATEST、NO_SETTLEMENT_TARGET（422）、IDEMPOTENCY_KEY_REUSED、TRIP_NOT_ACCESSIBLE、PAYMENT_NOT_FOUND・PREVIEW_NOT_FOUND・SETTLEMENT_NOT_FOUND（404）。

## DB 設計

正本 `sql/01_finance.sql` の表・制約を Drizzle の定義にし、migration を生成する。`settlement` スキーマを新しく作る。

| 表 | 差分・補足 |
| --- | --- |
| `record.payments` | `amount_yen BETWEEN 1 AND 9999999`（正本から変える）。負担額・寄与の CHECK、`(trip_id, plan_id)` の複合 FK、`(trip_id, payer_slot)`・`(trip_id, created_by)` の参加者への FK は正本どおり |
| `record.payment_cancellations` | 正本どおり（1 支払いに 1 取り消し） |
| `settlement.previews`・`preview_items` | 正本どおり（指紋は 64 桁の 16 進） |
| `settlement.settlements`・`items` | 正本どおり（`UNIQUE preview_id`、`UNIQUE (trip_id, sequence)`、`completion_kind` と合計の CHECK） |
| `settlement.cancellations` | 正本どおり |
| `settlement.active_claims` | 正本どおり（`PK (payment_id, kind)`。有効な BASE・REVERSAL の重複を防ぐ） |
| `settlement.pending_items`（VIEW） | 作らない。対象の導出は UseCase とそのテストで確かめ、VIEW に整合を任せない（正本の注記どおり） |

- 追記のみのトリガー（`infra.reject_history_mutation`）を、支払い・取り消し・確認・明細・精算・精算の取り消しに付ける（custom migration）。`active_claims` は消すので付けない。
- `app_runtime` の権限: `settlement` スキーマの USAGE、履歴の表（支払い・取り消し・確認・明細・精算・精算の取り消し）は SELECT・INSERT だけ、`active_claims` は SELECT・INSERT・DELETE、`trip_finance_guards` に UPDATE（`next_settlement_sequence` の列だけ。`SELECT … FOR UPDATE` の行ロックにも UPDATE 権限が要る）を足す。`infra.command_receipts` の SELECT・INSERT と `trip_finance_guards` の SELECT・INSERT は旅行・予定の段階（migration 0004）で付与済み。GRANT のテスト（旅行・予定の段階と同じ形）を足し、`app_runtime` で最初の書き込みと同じキーの再送が通ることを確かめる。
- 受領の `response_body` は財務の操作でも保存する（再送で元の DTO を返すため）。

## フロントエンド設計

### 画面とルート

| URL | 画面 | v3 | 取得 |
| --- | --- | --- | --- |
| `/trips/{tripId}/payments/new?planId=` | 支払いを記録（シート。後ろにしおり） | 支払いを記録・割合を指定・関連する予定 | getTrip、`planId` があれば getPlan（同じ旅行の予定かを確かめて選んだ状態にする。しおりの表示日と違う日の予定でも選べる）、関連する予定の選択で選んだ日の getItinerary |
| `/trips/{tripId}/settlement` | 精算 | 精算・内訳・対象 0 件・0 円・取得失敗 | getBalance、listSettlementPreviews、listSettlements |
| `/trips/{tripId}/settlement/previews/{previewId}` | 受け渡しの確認 | 受け渡しの確認・記録する前の確認のダイアログ・0 円の確認 | getSettlementPreview |

- 下部: タブに「精算」を足し、主ボタン「支払いを記録」を出す（旅行・予定の段階では「しおり」のタブだけに絞っていたものを戻す）。ホーム・記録のタブは次の段階。
- 予定の詳細に「支払いを記録」の導線（関連する予定を選んだ状態で開く）。
- 金額は `shared/lib/yen.ts` で文字列 ⇔ BigInt を変換し、Number に通さない。二人の負担は入力のたびに画面でも計算して見せる（サーバーと同じ式。保存はサーバーの計算を正とする）。
- 確認の検証結果のうち、`cancelled_items_ack_required`・`target_changed` は今回は「この確認では記録できません。精算の画面に戻って確認し直してください」と最新の精算への導線だけを出す（了承の画面は次の段階）。`already_completed`・`completed_then_cancelled` は既存の精算への導線。

### クエリと再取得

| 保存 | 再取得するもの |
| --- | --- |
| 支払いの記録・取り消し | 残額、確認の一覧、その旅行の確認の詳細（開いている確認の検証結果が変わるため。固定した明細と金額は書き換えない） |
| 確認の作成 | 確認の一覧 |
| 精算の完了・取り消し | 残額、確認の一覧、精算の一覧、その確認 |

### 結果不明からの復帰（ADR-0006）

- `shared/browser/pending-requests.ts`: IndexedDB の 1 つのデータベース `tomotabi` の `pending-requests` に、`{ id, userId, tripId, operation, url, method, bodyJson, idempotencyKey, ifMatch, createdAt }` を保存する。
- 送る直前に保存し、保存に失敗したら送らない（要件 F-53）。成功・確定した拒否で消す。結果不明（network・5xx・解釈できない応答）では残す。
- 画面を開いたとき、同じ利用者・同じ旅行・同じ操作の保留があれば、入力を固定して「保存されたか確認できません」と「同じ内容で確認する」を出す。送るのは本人の操作だけ。
- ログアウトの成功時にその利用者の保留を消す。保留があれば、ログアウトの前に「確認できていない保存があります」と出す（ログアウトは止めない）。
- 描画中に IndexedDB を触らない（effect の中で）。

## バックエンド設計

- Domain は Nest・Drizzle に依存しない。`Yen`（bigint のブランド型）、`Payment.create`（負担額・寄与。要件 F-04・F-05）、`deriveTargets(payments, cancellations, activeClaims)`、`fingerprintOf(paymentHistory)`、`balanceOf(targets)`。
- `fingerprintOf`: その支払いの有効な BASE・REVERSAL の精算 ID、その支払いを含む精算の明細と精算の取り消しの ID を、決まった順に並べて sha256（詳細設計「支払いと精算」の「確認内容の保持・再開」）。
- UoW の文脈は型付きのポートの限定集合（旅行・予定の段階と同じ形）。生の tx を渡さない。

## エラー処理

- 形式違反は 400、値の規則違反は 422、業務の競合は 409、参加していない旅行は 403、旅行の中で対象が無いは 404。
- ロック待ち: 財務の UoW の始めに `SET LOCAL lock_timeout = '3s'`。待ちきれない・デッドロック（40P01）は巻き戻して 503 TEMPORARILY_UNAVAILABLE（retryable）。UseCase では再試行しない（クライアントが同じ要求で送り直せば受領で二重にならない）。【決めてほしい点。推奨: 3 秒・自動の再試行なし】

外部 I/O の 5 項目（DB・IndexedDB）:

- (a) リトライ: サーバーでは自動で再試行しない。クライアントは結果不明のとき、本人の操作で同じ要求を送る
- (b) タイムアウト: `lock_timeout` 3 秒、既存の `statement_timeout` 5 秒
- (c) 冪等性: Idempotency-Key と受領。受領は自動で消さない
- (d) 部分失敗: 履歴・占有・受領は同じトランザクション。途中の失敗は全部巻き戻す
- (e) フォールバック: IndexedDB が使えないときは送らずに止める（黙ってメモリだけにしない）

## ログと監視

書き込みのログは旅行・予定の段階と同じ形（operation・tripId・resourceId・result・errorCode・durationMs）。金額・用途・明細はログに出さない。

## セキュリティ

- 参加者の認可は SQL の条件で行う（`trip_id` と参加者の両方）。別の旅行の支払い・確認・精算の ID を混ぜられない（複合 FK と WHERE）。
- 403 と 404 の使い分けで旅行の存在を漏らさない。
- IndexedDB に Cookie・トークン・Google の情報・未送信の入力を入れない。利用者ごとに分け、ログアウトで消す。
- 金額や対象をクライアントの申告で確定しない。

## 性能

二人の旅行なので件数は小さい（支払い数百件まで）。残額は旅行の支払い・取り消し・占有を 1 回ずつ読んで導出する。一覧はカーソルで 20 件ずつ。

## テスト方針

- Domain の単体: 負担額・寄与（1,001 円の折半、0／100%、両方の払った人、上限）、対象の導出の表（詳細設計「支払いと精算」の「次回対象の導出」の 5 行と、不正な 2 つの状態）、指紋、残額。`finance_model_check.py` の筋書き（取り消しの順序、重複取り消し、確認後の追加、二重完了、取り消し済み対象の例外、最新の制限、再精算、0 円、古い確認）を TypeScript の単体テストに移す。
- 実 DB と HTTP（`tests/db/finance-http.db.test.ts`）: 詳細設計「テストと監視・CI」のお金の観点（T-01〜T-10。要件定義の受け入れ条件 1 に中身）。二つの接続での同時の完了・取り消し・最新の取り消し、応答が消えたあとの再送、途中の失敗での巻き戻し、別の旅行の並行処理、占有を履歴から作り直した結果との一致、GRANT。
- web の単体: 支払いの入力（分け方 → 割合 → 二人の負担の表示）、精算の状態の出し分け、確認のチェックと完了、IndexedDB の保留（保存失敗で送らない、再読み込み後の表示、ログアウトで消す）。
- E2E: 支払いを記録 → 精算 → 受け渡しの確認 → 完了、0 円、確認後の追加支払いで金額が変わらない、結果不明のあと再読み込みして同じ内容で確認し 1 件だけ。

## 移行とリリース

新しい表・スキーマ・トリガー・権限の migration を足すだけ。本番のデータはまだ無い。

## リスク

| リスク | 対策 |
| --- | --- |
| 対象の導出や指紋の誤りで、お金がずれる | 正本のモデル（`finance_model_check.py`）の筋書きを単体テストに移す。占有を履歴から作り直した結果と一致するかを実 DB で毎回確かめる |
| 同時の操作で占有が二重になる | guard の行ロックと `active_claims` の PK の二重の防ぎ。二つの接続のテスト |
| IndexedDB がブラウザで使えない（プライベートモードなど） | 送らずに止めて案内する。E2E で通常の場合を確かめる |
| 変更が大きく、委譲 1 回に収まらない | 実装計画で PR を分ける（DB → 支払い → 残額と確認 → 精算 → web の共通（IndexedDB）→ 画面 → E2E） |

## 未決事項

1. ロック待ちの上限と再試行（エラー処理）。推奨: `lock_timeout` 3 秒、サーバーでの自動の再試行なし。
2. IndexedDB を標準の API だけで書くか、小さなライブラリ（`idb`）を使うか（ADR-0006）。
3. 精算の画面の未完了の確認の欄で、相手が作った確認を見せるか。正本は「自分の未完了確認」。推奨: 正本どおり自分の分だけ。
