# 設計書: m2-trips-and-plans

- ステータス: draft（ユーザー承認待ち）
- レベル: L3 / ユーザー承認: 必要
- 関連: docs/requirements/m2-trips-and-plans.md / docs/decisions/ADR-0004-m2-web-query-and-api-validation.md
- 前提: M1（docs/designs/m1-auth-onboarding.md）が main に入っていること
- 正本: `docs/旅行アプリ設計 3/詳細設計/04`・`05`・`07`・`02`・`11`、`sql/01`・`03`・`04`、`openapi.trips.json`・`openapi.planning.json`、`docs/design/handoff-v3/`。本書はそれを M1 までの実装に落とす判断をまとめたもの。業務ルールは変えない。変えるところは「正本からの差分」に理由付きで列挙する

## 背景

M1 で認証・Guard・migration・ロールの土台ができた。旅行・予定は、M3 以降のすべて（支払い・精算・記録・通知）の親になる。M2 では、旅行と予定の機能そのものに加えて、M3 の金銭の書き込みがそのまま使う共通部品（ETag・Idempotency-Key・receipt・エラー形式・ロック順序・画面の保存状態）を完成させる。

## 目的

要件 F-01〜F-27 を満たす。M3 が「receipt と保存状態の部品を使い、trip_finance_guards をロックするだけ」で始められる形にする。

## 要件

docs/requirements/m2-trips-and-plans.md の F-01〜27、N-01〜13、E-01〜22、B-01〜09。

## 対象範囲

apps/api（planning モジュール、record モジュールの照会部分、common/http の書き込み部品、DB スキーマと migration）、apps/web（trips / plans の feature、screens、shared/api の拡張、共通の状態表示、TanStack Query）、packages/contracts（trips.json・planning.json）、orval.config.ts、ADR-0004。

## 対象外

達成・予約の書き込み API と画面、記録一覧、ホームの集約 API（M4）。支払い・精算（M3）。通知（M5）。IndexedDB の未確定要求の永続化（M3）。Playwright E2E。

## 現状構成

- api: `modules/identity`（Guard が userId を渡す）と `modules/foundation`（M0 の検証）。共通の UnitOfWork IF は `adapter/transaction/unit-of-work.ts` の `run(work)` だけで、実装は foundation の中にある。エラー応答は Nest 例外に `{ code, message }` を渡す形で、共通のフィルターは無い。入力 body を検証する API はまだ無い。
- DB: migration `0000_identity_tables`・`0001_app_runtime_grants`。identity スキーマだけ。
- web: `app/page.tsx` が最小ホーム（表示名とログアウト）。`shared/api` は Orval の生成関数 + Zod 検証 + neverthrow の `callApi`。`ApiFailure` は応答本文を捨てる（network / http(status) / invalid-json / validation）。取得状態ライブラリは無い。
- contracts: `openapi/auth.json`・`foundation.json`。

## 変更後構成

```text
apps/api/src/
  common/
    domain/
      user-id.ts                        既存
      local-date.ts                     YYYY-MM-DD の値型（実在日の検証、比較）
      local-time.ts                     HH:mm の値型
      bounded-text.ts                   前後の空白除去・コードポイント数の検証
    http/
      api-error.ts                      業務エラー（code・HTTP 状態・retryable）の型
      api-error.filter.ts               全例外を { code, message, requestId, retryable } へ（APP_FILTER）
      etag.ts                           If-Match の解析、ETag の生成
      idempotency-key.ts                ヘッダーの解析（UUID）
      zod-body.pipe.ts                  生成した Zod スキーマで body / query を検証
    idempotency/
      command-receipt.ts                receipt の値と request_hash の計算（純粋関数）
  adapter/
    transaction/unit-of-work.ts         既存 IF（変更なし）
    clock/clock.ts                      現在時刻と「日本時間の今日」の IF
  infrastructure/
    database/schema/planning.ts         trips・trip_participants・plans
    database/schema/record.ts           plan_events・plan_event_cancellations・active_plan_events
    database/schema/infra.ts            command_receipts・trip_finance_guards
    database/pg-command-receipts.ts     receipt の読み書き（UnitOfWork の文脈で使う）
    clock/system-clock.ts
  modules/planning/
    planning.module.ts
    controller/trips.controller.ts      POST/GET /trips、GET/PATCH /trips/:id、start、finish、PUT period
    controller/plans.controller.ts      itinerary、POST/GET/PATCH plans、move、cancel
    usecase/                            1 操作 1 クラス（create-trip、rename-trip、change-trip-period、
                                        start-trip、finish-trip、list-trips、get-trip、get-itinerary、
                                        create-plan、update-plan、move-plan、cancel-plan、get-plan）
    domain/
      trip.ts                           Trip（状態遷移・期間の不変条件）
      plan.ts                           Plan（部分更新の差分判定・取りやめ・種類変更）
      plan-kind.ts                      種類と達成 / 予約の対象
      trip-period.ts                    期間（開始 ≦ 終了、日付の包含）
    adapter/
      inbound/                          各 UseCase の入力 IF・入力 / 結果型
      outbound/
        planning-work-context.ts        UnitOfWork に渡す限定集合（下記）
        trip.repository.ts
        plan.repository.ts
        participants.port.ts            allowlist の二人を読む（identity の公開照会）
        record-history.port.ts          予定に達成・予約の履歴があるか（record の公開照会）
        planning-read.port.ts           一覧・しおり・予定詳細の読み取り
    infrastructure/
      pg-planning-unit-of-work.ts
      drizzle-trip.repository.ts
      drizzle-plan.repository.ts
      pg-planning-read.ts
  modules/record/
    infrastructure/pg-record-history.query.ts   履歴の有無と有効な達成・予約の照会（書き込みなし）
  modules/identity/
    infrastructure/pg-participants.query.ts     allowlist の二人（slot 順）の照会
  composition/
    planning-composition.module.ts      planning の port と identity / record の照会実装を結ぶ
apps/api/drizzle/
  0002_planning_record_infra.sql        generate（表・制約・索引）
  0003_history_triggers.sql             custom（reject_history_mutation とトリガー、plans の CHECK の一部）
  0004_planning_grants.sql              custom（app_runtime への GRANT）
packages/contracts/openapi/
  trips.json                            M2 の操作（createTrip、listTrips、getTrip、renameTrip、startTrip、finishTrip）
  planning.json                         M2 の操作（getItinerary、createPlan、getPlan、updatePlan、movePlan、
                                        cancelPlan、updateTripPeriod）。getTrip は trips.json に 1 つだけ置く
apps/web/src/
  app/
    providers.tsx                       QueryClientProvider（Client Component）
    page.tsx                            入口: 前回の旅行 → しおり / 旅行一覧へ（F-23）
    trips/page.tsx、trips/new/page.tsx
    trips/[tripId]/itinerary/page.tsx
    trips/[tripId]/plans/new/page.tsx、plans/[planId]/page.tsx、plans/[planId]/edit/page.tsx
  screens/
    trips/        旅行一覧（15 相当のページ版・19）、旅行の作成
    itinerary/    しおり（08）＋旅行ヘッダーとメニュー（16〜18）
    plan-detail/  予定の詳細（09）と操作
    plan-form/    予定の追加・編集
  features/
    trips/{ui,model,api}/               旅行カード・作成フォーム・メニュー・開始 / 終了・名前 / 期間の変更
    plans/{ui,model,api}/               予定カード・詳細・フォーム・日の移動・取りやめ
    auth/                               既存（表示名・ログアウトをメニューから使う）
  shared/
    api/
      api-failure.ts                    拡張: http に code（許可リストの文字列）を持たせる
      http-client.ts                    拡張: エラー本文から code だけを取り出す。ETag を返す
      mutation-request.ts               書き込み要求の固定（キー・本文・If-Match）と再送
      query-client.ts                   QueryClient の既定値
    lib/
      local-date.ts                     日本時間の今日、期間の日付列、表示
      text-length.ts                    コードポイント数
    ui/
      sheet.tsx、dialog.tsx、field.tsx、segmented.tsx、toast.tsx
      state/                            loading、refetch-failed（v1）、session-expired（C-1）、
                                        not-available（C-2）、offline-banner（C-3）、
                                        save-unknown（C-4）、conflict（C-5）
    browser/
      selected-trip-store.ts            前回の旅行 id（利用者ごと・localStorage）
```

planning モジュールに Service 層は作らない。複数の Domain にまたがる計算が無く、規則は Trip・Plan・TripPeriod 自身に置けるため（詳細設計 11 §4「委譲だけの Service を必須にしない」）。record モジュールは M2 では照会の実装 1 つだけで、Controller / UseCase は M4 で作る。

## DB 設計

migration `0002` を drizzle-kit generate で作り、トリガーと GRANT はカスタム migration に分ける（ADR-0003）。参照 SQL との対応と、変えた点を示す。

### 表

| 表 | 主な列・制約 | 参照 SQL |
|---|---|---|
| `planning.trips` | id（uuid, gen_random_uuid）、name varchar(100)、starts_on / ends_on date、status（planning / traveling / finished）、version bigint、created_by、created_at、updated_at、started_at / started_by、finished_at / finished_by。CHECK: 名前が空白だけでない、starts_on ≦ ends_on、状態と開始 / 終了列の組（`trip_lifecycle_fields`）。索引 (created_at DESC, id DESC) | 03・04 |
| `planning.trip_participants` | PK(trip_id, slot)、UNIQUE(trip_id, user_id)、slot IN (0,1)、user_id → identity.users。索引 (user_id, trip_id) | 00 |
| `planning.plans` | id、trip_id、UNIQUE(trip_id, id)、name varchar(100)、kind、planned_date、planned_time time(0)、memo varchar(2000)、cancelled_at / cancelled_by、version、created_at、updated_at。CHECK: 名前、時刻が分単位、取りやめの 2 列の組。FK (trip_id, cancelled_by) → 参加者。索引 (trip_id, planned_date, planned_time, created_at, id) | 00・03 |
| `record.plan_events` | 参照 SQL のとおり。id は gen_random_uuid を既定にする（M4 で使う） | 03 |
| `record.plan_event_cancellations` | 参照 SQL のとおり | 03 |
| `record.active_plan_events` | 参照 SQL のとおり | 03 |
| `infra.trip_finance_guards` | trip_id PK → trips、next_settlement_sequence bigint DEFAULT 1 | 01 |
| `infra.command_receipts` | PK(actor_id, operation, idempotency_key)、trip_id、request_hash（64 桁の 16 進）、resource_type、resource_id、http_status（200 / 201）、response_body jsonb、created_at。FK (trip_id, actor_id) → 参加者。CHECK: resource_type が plan / trip なら response_body が NOT NULL | 01・03 |

- `trips.started_by` / `finished_by` の FK は `(id, started_by) → trip_participants(trip_id, user_id)`。trips と trip_participants が互いを参照するため、表を作ったあとに ALTER で FK を足す（generate の出力順を確認し、必要ならカスタム migration に移す）。
- `command_receipts.resource_type` の CHECK は、M3〜M4 の種類（payment ほか）も最初から含める。後の migration で CHECK を張り替える手間を省くため。値を足すだけで、使わない種類があっても害は無い。
- `trips.created_by` は `identity.users` を参照する（参考 SQL どおり）。参加者 FK にしないのは、旅行の INSERT の時点では参加者の行がまだ無いため。

### 追記のみの保証（カスタム migration 0003）

`infra.reject_history_mutation()` を作り、`record.plan_events`・`record.plan_event_cancellations` に BEFORE UPDATE OR DELETE のトリガーを付ける（参照 SQL 01・03）。M3 で支払いの表にも同じ関数を使う。

### GRANT（カスタム migration 0004）

app_runtime には次だけを与える。DELETE はどの表にも与えない。表の権限に加え、`GRANT USAGE ON SCHEMA planning, record, infra TO app_runtime` を最初に与える（スキーマの USAGE が無いと表の権限があってもアクセスできない。0001 の identity と同じ形）。

| 表 | 権限 |
|---|---|
| planning.trips | SELECT、INSERT、UPDATE（name、starts_on、ends_on、status、version、updated_at、started_at、started_by、finished_at、finished_by） |
| planning.trip_participants | SELECT、INSERT |
| planning.plans | SELECT、INSERT、UPDATE（name、kind、planned_date、planned_time、memo、cancelled_at、cancelled_by、version、updated_at） |
| record.plan_events・plan_event_cancellations・active_plan_events | SELECT（INSERT と active の DELETE は M4 で足す） |
| infra.trip_finance_guards | SELECT、INSERT（UPDATE は M3） |
| infra.command_receipts | SELECT、INSERT |

`SELECT … FOR SHARE / FOR UPDATE` には対象表の UPDATE 権限（どれか 1 列）が要る。trips・plans は UPDATE を持つのでロックできる。allowlist は M1 で UPDATE を禁止している（E-13）ため、ロックしない（「正本からの差分」1）。

## API 設計

すべて `/api` の下。Cookie 認証（SessionGuard）と、書き込みの Origin / Content-Type（OriginGuard）は M1 の共通 Guard に従う。応答は `Cache-Control: private, no-store`。

| Method | Path | 必須ヘッダー | 成功 | 主な失敗 |
|---|---|---|---|---|
| POST | /trips | Idempotency-Key | 201（再送は元の状態）＋ETag | 400、409 PARTICIPANTS_NOT_READY / IDEMPOTENCY_KEY_REUSED、422 |
| GET | /trips?status=&cursor=&limit= | — | 200 `{ items, nextCursor }` | 400 |
| GET | /trips/{tripId} | — | 200＋ETag | 403 |
| PATCH | /trips/{tripId} | Idempotency-Key、If-Match | 200＋ETag | 403、409、422、428 |
| PUT | /trips/{tripId}/period | Idempotency-Key、If-Match | 200＋ETag | 403、409、422 PLAN_OUTSIDE_TRIP_PERIOD、428 |
| POST | /trips/{tripId}/start・/finish | Idempotency-Key、If-Match | 200＋ETag | 403、409 INVALID_TRIP_TRANSITION / VERSION_CONFLICT、428 |
| GET | /trips/{tripId}/itinerary?date= | — | 200 Itinerary | 403、422（期間外の日付） |
| POST | /trips/{tripId}/plans | Idempotency-Key | 201＋ETag | 403、409、422 PLAN_OUTSIDE_TRIP_PERIOD |
| GET | /trips/{tripId}/plans/{planId} | — | 200＋ETag | 403、404 |
| PATCH | /trips/{tripId}/plans/{planId} | Idempotency-Key、If-Match | 200＋ETag | 403、404、409 PLAN_HAS_RECORD_HISTORY、422、428 |
| POST | /trips/{tripId}/plans/{planId}/move | Idempotency-Key、If-Match | 200＋ETag | 403、404、409、422 PLAN_OUTSIDE_TRIP_PERIOD、428 |
| POST | /trips/{tripId}/plans/{planId}/cancel | Idempotency-Key、If-Match | 200＋ETag | 403、404、409 PLAN_CANCELLED、428 |

- DTO は詳細設計の Trip・Plan・Itinerary・PlanCreate・PlanPatch・Move・Period・TripCreate・TripRename をそのまま使う。Plan の `achievement` / `booking` は M2 でも返す（表に行が無ければ null）。
- GET /trips の `limit` は既定 20・最大 50。カーソルは `(created_at, id)` を base64url にした不透明な文字列で、改ざんされていたら 400。
- GET itinerary の `date` を省略したら、日本時間の今日が期間内なら今日、外なら初日。明示された期間外の日付は 422（画面は「旅行期間外です」と日付選択を出す。07 §5）。
- 403 と 404 の使い分け: 旅行が存在しない・参加していないは、どちらも 403 `TRIP_NOT_ACCESSIBLE`（存在を漏らさない）。参加済みの旅行の中で予定が無い・別の旅行の予定なら 404 `PLAN_NOT_FOUND`（詳細設計 03 の 403 / 404 の定義どおり）。

### エラー応答

全例外を `ApiErrorFilter`（APP_FILTER）で `{ code, message, requestId, retryable }` にする。requestId は pino-http の要求 id（UUID）。M1 の Guard の例外もこの形になる（項目が増えるだけで、既存の `code` は変わらない）。想定外の例外は 500 `INTERNAL_ERROR`（message は固定文。スタックは応答に出さずログだけ）。DB 接続の失敗は 503 `TEMPORARILY_UNAVAILABLE`、retryable=true。

| code | 状態 | 使う場面 |
|---|---|---|
| INVALID_REQUEST | 400 | JSON / ヘッダー / クエリの形式違反、If-Match の形式違反、未知の項目 |
| VALIDATION_FAILED | 422 | 値の規則違反（文字数、日付の実在、開始 > 終了） |
| IF_MATCH_REQUIRED | 428 | If-Match が無い |
| VERSION_CONFLICT | 409 | If-Match が現在の version と違う |
| IDEMPOTENCY_KEY_REUSED | 409 | 同じキーで入力が違う |
| PARTICIPANTS_NOT_READY | 409 | allowlist の二人が揃っていない |
| INVALID_TRIP_TRANSITION | 409 | 不正な状態遷移 |
| PLAN_OUTSIDE_TRIP_PERIOD | 422 | 予定の日付・移動先・期間変更の違反 |
| PLAN_HAS_RECORD_HISTORY | 409 | 履歴のある予定の種類変更 |
| PLAN_CANCELLED | 409 | 取りやめ済みの予定の取りやめ |
| TRIP_NOT_ACCESSIBLE | 403 | 旅行が無い・参加していない |
| PLAN_NOT_FOUND | 404 | 旅行の中に予定が無い |

### 入力検証

Controller の境界で、contracts の OpenAPI から Orval で生成した Zod スキーマを使う（ADR-0004）。形式違反（型・未知の項目・パターン）は 400、Domain の規則違反は 422 にする。

- 未知の項目: 詳細設計の入力スキーマは `additionalProperties: false` だが、Zod の既定の object は未知のキーを黙って捨てる。Orval の `override.zod.strict.body`（とクエリ）を有効にして `.strict()` を生成し、未知の項目を 400 にする。空の PATCH（`minProperties: 1`）は Pipe の後で 400 にする。
- 文字数: 契約の `maxLength`（JSON Schema ではコードポイント数）はそのまま残すが、Zod の `.max()` は UTF-16 の長さで数えるため、絵文字を含む有効な名前を先に拒否してしまう。そこで API・web の検証用の生成では、入力 body の文字列の `maxLength` を Orval の input transformer で外し、文字数は Domain の `BoundedText`（コードポイント）で 422 にする。web のフォームも同じコードポイントの関数（`shared/lib/text-length`）で検証する。絵文字 51 個（UTF-16 で 102）の名前が通る境界テストを置く。Zod のスキーマだけで規則を済ませず、文字数（コードポイント）・日付の実在・前後の空白は Domain の値型（`BoundedText`、`LocalDate`、`LocalTime`）で検証する。DB の CHECK が最後の防御になる。

## 書き込みの共通の流れ

すべての書き込み UseCase は同じ順序で進む（詳細設計 01 §5、02、04 §2、05 §4）。

```text
Guard（Origin → セッション → userId）
→ Controller: 形式の検証、Idempotency-Key・If-Match の解析、request_hash の計算
→ UseCase: UnitOfWork.run(ctx => {
     1. 旅行行をロック（下表）。無い・参加していない → 403
     2. receipt を (userId, operation, key) で探す
          あり・hash 一致   → 保存した http_status・response_body を返す（ETag は body.version から）
          あり・hash 不一致 → 409 IDEMPOTENCY_KEY_REUSED
     3. 対象行をロック。If-Match と version を比べる（不一致 → 409 VERSION_CONFLICT）
     4. Domain の規則で検証し、変更を作る（実質同じ値なら version を増やさない）
     5. 保存。receipt を INSERT（response_body に成功 DTO）
   })
→ COMMIT 後に応答（ETag ヘッダーを付ける）
```

- request_hash は `sha256(正規化 JSON { operation, tripId, resourceId, body, ifMatch })`。body は検証後の正規化した値（名前は前後の空白を除いたもの、キーの順序は固定）。
- 旅行の作成は、ロックする旅行がまだ無いので、1 と 3 の代わりに allowlist の二人を読む。同じキーの同時作成は、receipt の PK 違反で負けた側をロールバックし、新しいトランザクションで既存の receipt を読み直して hash を比べる（E-17）。receipt の読み直しで一致すれば、勝った側と同じ 201 と DTO を返す。
- 同じ状態への遷移（B-07）: ETag が一致し、既に目的の状態なら、version も日時も変えずに現在の旅行を 200 で返す。receipt は保存する（同じキーの再送で同じ結果を返すため）。

### ロック順序

| 操作 | 旅行行 | 予定行 |
|---|---|---|
| 予定の追加 | FOR SHARE | — |
| 予定の更新・日の移動・取りやめ | FOR SHARE | FOR NO KEY UPDATE |
| 期間の変更 | FOR UPDATE | （全予定の日付を読むだけ） |
| 旅行名の変更・開始・終了 | FOR UPDATE | — |

- 期間の変更（FOR UPDATE）と予定の追加・移動（FOR SHARE）は互いを待つので、期間外の予定は成立しない（E-18）。
- 種類変更は予定行を FOR NO KEY UPDATE で持ったまま履歴を照会する。M4 の達成・予約の追加も同じ予定ロックを取る設計なので、記録が先なら種類変更を拒否し、種類変更が先なら新しい種類で記録の可否を判定する（E-19。M2 のテストでは、別の接続で予定をロックしてから plan_events に行を入れて再現する）。
- M3 の財務は旅行行ではなく trip_finance_guards をロックする。予定と財務を同じトランザクションで扱う将来の機能では、旅行 → 予定 → guard の順に固定する（逆順にしない）。

### UnitOfWork の文脈

planning の UseCase に渡す文脈は、型付きの Repository・照会・receipt の限定集合にする。生の tx や SQL 実行口は渡さない（詳細設計 11 §5）。

```ts
interface PlanningWorkContext {
  trips: TripRepository;            // lockForShare / lockForUpdate / insert / update
  plans: PlanRepository;            // lockForUpdate / insert / update / datesOutside(period)
  participants: ParticipantsPort;   // allowlist の二人（slot 順）
  recordHistory: RecordHistoryPort; // hasHistory(planId)
  receipts: CommandReceiptStore;    // find / insert
  financeGuards: FinanceGuardWriter;// create(tripId)
}
```

`PgPlanningUnitOfWork` が 1 つの pg client で BEGIN し、これらを同じ Drizzle tx に束ねて渡す。foundation の UnitOfWork と同じ形（M0 の型を踏襲）。

## Domain

| 型 | 守る条件 |
|---|---|
| `BoundedText`（common） | 前後の空白を除き、1〜上限コードポイント。メモ用に「空なら null」の変種 |
| `LocalDate`（common） | `YYYY-MM-DD` で実在する日。比較・日数 |
| `LocalTime`（common） | `HH:mm`、00:00〜23:59 |
| `TripPeriod` | startsOn ≦ endsOn、`contains(date)` |
| `Trip` | 状態遷移（start: planning のみ、finish: traveling のみ、同じ状態は変化なし）、名前・期間の変更、version |
| `PlanKind` | 5 種類。`supportsAchievement`（place / food / shopping）、`supportsBooking`（food / lodging / transport）は M4 で使う |
| `Plan` | 部分更新の差分（変化が無ければ変更なし）、取りやめ（一度だけ）、種類変更は「履歴なし」を引数で受ける |

Domain は Nest・Drizzle・HTTP に依存しない。M1 の `UserId` と同じくブランド型と parse 関数で作る。

## フロントエンド設計

### 取得状態（TanStack Query。ADR-0004）

- `QueryClient` の既定: `staleTime: 0`、`refetchOnWindowFocus: true`（07 §3 の「表示へ復帰したときの再取得」）、`retry` は network 失敗の GET だけ 1 回、4xx は再試行しない。mutation は自動で再試行しない。
- クエリキー: `["trips", filter]`、`["trip", tripId]`、`["itinerary", tripId, date]`、`["plan", tripId, planId]`。
- 再取得中は前回の表示を残して「更新中」、再取得の失敗は前回の表示に「更新できていません」と取得時刻（v1 の部品）。初回の失敗は「取得できませんでした」＋再試行。失敗を 0 件に変えない。
- 保存の成功後は 07 §11 の表に従って関連するキーを invalidate する（例: 予定の移動 → 予定・旧日と新日のしおり）。
- 取得関数は既存の `callApi`（Zod 検証 + ResultAsync）を包み、Err を投げ直して Query に渡す。UI は `ApiFailure` の種類で状態を出し分ける。

### ApiFailure の拡張

`{ kind: "http"; status; code: ApiErrorCode | null }` にする。`http-client` は非 2xx の本文を JSON として読み、`code` が既知の値（上のエラー表の code）のときだけ取り出す。message・requestId は取り出さず、画面に出さない（M0 の方針を維持）。成功応答からは `ETag` ヘッダーを取り出して返す。

### 書き込みの要求と保存状態（07 §9 のメモリ内の部分）

`shared/api/mutation-request.ts` に、送信の直前に `{ operation, url, body, ifMatch, idempotencyKey }` を 1 組で固定する関数を置く。feature の model はこれを使って次の状態を持つ。

| 状態 | 条件 | 画面 |
|---|---|---|
| editing | 送信前 | 入力できる |
| saving | 送信中 | 同じ操作のボタンを止め「保存中」 |
| succeeded | 2xx | トースト（上部に 2 秒）。関連の再取得 |
| rejected | 4xx（400・403・404・409・422・428） | 入力を残し、code に応じて欄のエラー・C-2・C-5 を出す |
| unknown | network・5xx・応答の解釈に失敗 | C-4。入力を固定し「同じ内容で確認する」で同じ要求（同じキー・本文・If-Match）を送り直す |
| session-expired | 401 | C-1。401 は SessionGuard が UseCase の前に返すため、その要求では保存されていないと確定する（ログイン後に入力し直して送る）。ただし「結果不明のあと同じ要求で確かめたら 401」のときは、最初の要求の結果が分からないまま Google の往復でメモリが消える。このときは C-1 に「保存されたか確認できていません。ログイン後に{旅行 / 予定}を開いて確かめてください」を出し、ログイン後は画面の GET で本人が確かめる（M2 の限界。M3 の IndexedDB で同じ要求による確認に置き換える） |

- 入力を変えたら別の要求（新しいキー）。rejected のあとに直して送るときも新しいキー。IDEMPOTENCY_KEY_REUSED を新しいキーで自動再送しない。
- C-5（VERSION_CONFLICT）: 最新を GET し、違いのある項目ごとに「最新（相手）」と「あなたの入力」を並べる。「あなたの入力で保存」は最新の ETag と新しいキーで送る。「最新の内容で入力し直す」はフォームを最新で置き換える。

### 旅行の選択（F-23）

- `shared/browser/selected-trip-store` に `tomotabi:selected-trip:<userId>` のキーで tripId を保存する（localStorage。失敗しても動くよう try / catch）。
- `/` は `useMe` の userId で保存値を読み、`GET /trips/{id}` が 200 ならしおりへ、403 なら値を消して `/trips` へ、値が無ければ `/trips` へ。
- ログアウトの成功時に、その利用者のキーを消す。

### 画面とルート

| URL | 画面 | v3 | 取得 |
|---|---|---|---|
| `/` | 入口（遷移だけ） | — | getMe、getTrip |
| `/trips` | 旅行一覧。0 件は 19 | 15（ページ版）・19 | listTrips |
| `/trips/new` | 旅行の作成 | 無し（AI が組む） | — |
| `/trips/{tripId}/itinerary?date=` | しおり＋旅行ヘッダー・メニュー | 08・16・17・18 | getItinerary |
| `/trips/{tripId}/plans/new?date=` | 予定の追加（シート） | 無し（AI が組む） | getTrip |
| `/trips/{tripId}/plans/{planId}` | 予定の詳細と操作 | 09（操作は AI が組む） | getPlan |
| `/trips/{tripId}/plans/{planId}/edit` | 予定の編集（シート） | 無し（AI が組む） | getPlan |

- 下部のタブ: M2 では「しおり」だけを出す（「正本からの差分」2）。主ボタン「支払いを記録」は M3 で出す。
- 旅行ヘッダー: 旅行名・期間・状態バッジ、「…」でメニュー（16）。メニューに「旅行名と期間を変更」「旅行を開始する / 終了する」「旅行を切り替え」「ログアウト」（表示名つき）。
- 日付バー（08）: 期間の日を並べ、選択日は URL の `date` で再現する。長い旅行（日数が多い）は横スクロール。
- `app/*` の各 page は Server Component で params を検証し、Client Component の screen に渡す（M1 の sign-in と同じ形）。

### v3 に無い画面の組み方

v3 のトークン（色・書体・余白・角丸）と部品だけを使い、新しい色や部品の種類を足さない。スクリーンショットをユーザーが確認する（受け入れ条件 6）。

| 画面 | 組み方 |
|---|---|
| 旅行の作成 | 11「支払いを記録」と同じシート（上端の角丸 xl 28、見出し、閉じる）。項目は「旅行名」「開始日」「終了日」。日付は `<input type="date">`（端末標準のピッカー）。下端に主ボタン「旅行をつくる」 |
| 予定の追加・編集 | 同じシート。項目は名前、種類（2 列の選択。アイコン map-pin / fork-knife / shopping-bag / bed / train と文字）、日付（追加のみ。旅行期間の日を 11c と同じ 3 等分の日付選択）、時刻（「時刻未定」の切り替え＋ `<input type="time">`）、メモ。編集で種類を変えられないときは、選択を固定（C-4 と同じ固定色）し、理由「達成・予約の記録があるため、種類は変更できません」を隣に出す |
| 日の移動 | 予定の詳細から開く小さなシート。11c の日付選択だけ。同じ日なら保存ボタンを押せない |
| 取りやめの確認 | 17 と同じダイアログ。本文に予定名・日付と「達成・予約・支払いの記録は残ります」。ボタンは赤（取りやめは取り消しの一種のため、--color-danger）。キャンセルは副ボタン |
| 旅行名と期間の変更 | 作成と同じシート（値を入れた状態）。名前と期間は別の API なので、変わった方だけを送る（両方変わったら名前 → 期間の順に送り、途中で失敗したらその時点の結果を表示） |

## 正本からの差分（理由つき）

1. **旅行の作成で allowlist をロックしない**（05 §2 は FOR SHARE）。PostgreSQL の行ロックは UPDATE 権限を要し、M1 で app_runtime の allowlist の UPDATE を禁止した（E-13）ため。ロックが無いと「作成の途中で一方が利用停止される」競合が起き得るが、停止された利用者はログインできず、参加者の行が残っても情報は漏れない。停止の CLI は M1 の全セッション削除で守られる。
2. **M2 の下部タブは「しおり」だけ**（07 §2 は 4 タブ固定）。ホーム・記録・精算は M3・M4 で中身ができるため、空のタブを出さない。M4 でホームができたら入口を `/trips/{id}/home` に変える。
3. **存在しない旅行も 403**（05 §7 は 401 / 403 / 404 / 503）。参加していない旅行と区別すると存在が漏れるため、03 の「旅行非参加者は 403」に寄せる。画面（C-2）は 403 と 404 を同じ文言で出すので見た目は変わらない。
4. **期間外のしおりの日付は 422**（07 §5 は画面の動きだけを定義）。API で明示的に拒否し、画面が「旅行期間外です」を出す根拠にする。

## エラー処理

- UseCase の入口（UnitOfWork の外側）で業務エラーを `ApiError` に写す。Repository・Domain は例外をそのまま投げる（coding-standards）。
- pg の `40P01`（デッドロック）・`40001`（直列化失敗）は、ロック順序を守っていれば起きない想定。起きたら 503 `TEMPORARILY_UNAVAILABLE`（retryable=true）にし、自動の再試行はしない（画面は結果不明として同じ要求で確かめる）。
- receipt の PK 違反（同じキーの同時送信）は、ロールバック後の読み直しで結果を決める。

## ログと監視

- 業務の書き込みごとに、operation・tripId・resourceId・結果（created / replayed / rejected(code)）・所要時間を info で出す。旅行名・予定名・メモは出さない（利用者の入力。M1 の許可した項目だけを出す方針）。
- Idempotency-Key・request_hash は出さない（再送の相関は requestId で足りる）。

## セキュリティ

- 参加者の判定はすべて Guard の userId と `trip_participants` で行い、クライアントの申告を使わない。一覧・取得・書き込みのすべての SQL に認可済みの tripId を条件として付ける。
- 403 / 404 の出し分けで存在を漏らさない（「正本からの差分」3）。
- receipt の response_body には業務 DTO だけを保存する（Cookie・トークン・Google 情報を含めない）。
- 名前・メモは画面でテキストとして描画し、HTML として解釈しない（React の既定。`dangerouslySetInnerHTML` を使わない）。
- localStorage には tripId だけを保存し、認証情報を保存しない。

## 性能

二人利用のため目標値は置かない。一覧は索引 `(created_at DESC, id DESC)` とカーソル、しおりは `(trip_id, planned_date, …)` の索引で 1 日分を 1 回の SQL（有効な達成・予約を LEFT JOIN）で返す。

## テスト方針

| 層 | 道具 | 主な観点 |
|---|---|---|
| Domain | Vitest | 状態遷移、差分判定、文字数（コードポイント）、日付の実在・期間 |
| UseCase | Vitest + インメモリの文脈 | 共通の流れの順序（receipt が If-Match より先、ロックの取り方の呼び出し順） |
| HTTP + DB | Testcontainers（test:api-db） | 全 API の正常・異常、403 / 404、ETag、receipt の再送と不一致、参加者・guard の同時作成とロールバック（途中で失敗させる注入）、2 接続での同時実行（E-17・E-18・E-19）、migration と GRANT |
| web | Vitest + Testing Library | 保存状態（saving / succeeded / rejected / unknown / conflict）、同じ要求の再送（キー・本文・If-Match が同じ）、旅行の選択の入口、共通の状態表示 |
| 手動 | ローカルの Mac のブラウザで二人 | N-12・N-13、v3 に無い画面のスクリーンショット |

HTTP テストは M1 と同じく本番と同じ組み立て（`configure-app`）で起動する（#35・#39 の教訓）。

## 移行とリリース

- migration 0002〜0004 は空 DB と M1 の適用済み DB の両方に適用できることを確かめる（ローカル開発 DB は M1 の二人の登録が残っている）。
- 本番への適用は M6〜M7。

## 実装の分け方（案。実装計画で確定する）

| 段階 | 内容 | 依存 |
|---|---|---|
| M2-a | DB スキーマ・migration・GRANT、共通の書き込み部品（エラーフィルター、ETag、Idempotency、receipt、Zod の pipe）、旅行の API | — |
| M2-b | 予定の API としおり、履歴の照会（record） | M2-a |
| M2-c | web の基盤（TanStack Query、ApiFailure の拡張、保存状態、共通の状態表示、シート等の部品）と旅行の画面 | M2-a（契約） |
| M2-d | しおり・予定の画面 | M2-b・M2-c |
| M2-e | 手動確認とスクリーンショットの確認 | すべて |

## リスク

- Orval の Zod 出力を API 側で使う形は未検証（web 用の出力は M0 で確認済み）。`format: date` を実在日まで検証しないため、Domain の値型で補う前提にしている。`zod.strict` と、input transformer で入力 body の `maxLength` を外す設定が採用版で期待どおりに出るかを M2-a の最初に確かめる。
- trips と trip_participants の相互参照 FK を drizzle-kit generate が期待どおりの順で出力しない可能性。出なければカスタム migration に移す。
- v3 に無い画面の見た目がユーザーの期待と違う可能性。スクリーンショットで確認し、直しを M2-e で受ける。
- TanStack Query の `refetchOnWindowFocus` が、フォームの入力中に取得結果で欄を置き換えないよう、フォームはサーバー状態から初期値を一度だけコピーする（07 §11）。

## 未決事項

1. 「正本からの差分」1〜4 の承認（推奨: 4 つとも本書のとおり）。
2. foundation（M0 の検証 API と web の検証 UI）の扱い。推奨: M2 では残し、ログイン後の画面からの導線だけ外す。削除は別の L1 で行う。
3. 旅行名と期間を同じシートで変更し、API は別々に送る方式でよいか（推奨: よい。期間の変更は予定のはみ出し検証を伴うため、詳細設計どおり別 API にしておく）。
4. 実装の担い手（Claude Code / Devin）と分け方。推奨: 実装計画で決める。M2-a は共通部品の設計判断が多いため Claude Code、M2-b・M2-c・M2-d は Issue に切って Devin（SWE-2 High）も候補。
