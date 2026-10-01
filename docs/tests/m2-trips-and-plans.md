# 試験計画: m2-trips-and-plans

- 前提となる設計書: docs/designs/m2-trips-and-plans.md（2026-09-27 承認）
- レベル: L3
- 要件との対応: 各観点の「要件」列に docs/requirements/m2-trips-and-plans.md の ID を書く。全 ID の対応は末尾の表で確認する

## 試験種別

| 種別 | 手段 | CI | 対象 |
|---|---|---|---|
| 単体 | Vitest（DB なし） | `npm test` | Domain の値型・Trip・Plan、ETag・Idempotency-Key の解析、request_hash、エラーフィルター、Zod の Pipe、UseCase（インメモリの文脈） |
| 実 DB | Testcontainers `postgres:16-alpine`、ロール作成＋ migrate | `npm run test:api-db` | migration、権限、制約、トリガー、同時実行 |
| HTTP + 実 DB | `configure-app` で組んだ実アプリ＋ M1 の fixture セッション＋ app_runtime 接続 | `npm run test:api-db` | 全 API の正常・異常、ETag、receipt、403 / 404 |
| web 単体 | Vitest + Testing Library（API は fetch のモック） | `npm test` | 保存状態、同じ要求の再送、入口、共通の状態表示、フォームの検証 |
| 手動 | ローカルの Mac のブラウザで二人（M1 で登録済みの DB） | 対象外 | 一連の操作、v3 に無い画面の見た目 |
| E2E | 対象外（Playwright 未導入） | — | — |

HTTP テストは本番と同じ `configure-app` でアプリを作る（素の HTTP サーバーや別の `bodyParser` 設定にしない。IMP-2026-002）。DB への接続は app_runtime で行い、GRANT の不足がテストで見つかるようにする。

## 単体試験観点

| # | 観点 | 前提 | 操作 | 期待結果 | 分類 | 要件 |
|---|---|---|---|---|---|---|
| U-01 | BoundedText: 前後の空白を除く | なし | `"  京都  "` | `"京都"` | 正常 | B-01 |
| U-02 | BoundedText: 空白だけ・空 | なし | `"   "`、`""` | 例外（VALIDATION_FAILED） | 異常 | E-15 |
| U-03 | BoundedText: 上限（コードポイント） | 上限 100 | 100 文字 / 101 文字 / 絵文字 100 個（UTF-16 で 200） | 100 と絵文字 100 個は成功、101 は例外 | 境界 | B-01 |
| U-04 | メモ: 空は null、改行・内部の空白は保持 | 上限 2,000 | `""`、`"a\n  b"`、2,000 / 2,001 文字 | null、そのまま、2,001 は例外 | 境界 | B-05、E-15 |
| U-05 | LocalDate: 実在日 | なし | `2026-02-29`、`2028-02-29`、`2026-13-01`、`2026-9-1` | 2028-02-29 だけ成功 | 境界 | E-15 |
| U-06 | LocalTime | なし | `00:00`、`23:59`、`24:00`、`12:30:00`、`9:00` | 00:00・23:59 だけ成功 | 境界 | B-04、E-15 |
| U-07 | TripPeriod | なし | 開始 = 終了、開始 > 終了、`contains` の両端 | 日帰りは成功、逆順は例外、両端は含む | 境界 | B-02、B-03 |
| U-08 | Trip の状態遷移 | 各状態 | start / finish | planning→traveling、traveling→finished は成功。finished→start、planning→finish は INVALID_TRIP_TRANSITION。同じ状態は「変化なし」 | 正常・異常 | F-08、E-14、B-07 |
| U-09 | Plan の部分更新の差分 | 既存の予定 | 同じ値、1 項目だけ違う値、時刻・メモに null | 同じ値は「変化なし」、違えば変更、null は消去 | 正常 | F-12、B-08 |
| U-10 | Plan の種類変更 | 履歴あり / なし | kind を変える | 履歴ありは PLAN_HAS_RECORD_HISTORY、なしは成功。種類が同じなら履歴ありでも成功（変化なし） | 異常 | F-15、E-12 |
| U-11 | Plan の取りやめ | 未取りやめ / 取りやめ済み | cancel | 1 回目は日時と操作者が入る、2 回目は PLAN_CANCELLED。編集で取りやめは解除されない | 異常 | F-14、E-13 |
| U-12 | If-Match の解析 | なし | `"3"`、なし、`*`、`W/"3"`、`"3", "4"`、`3`、`"0"`、`"03"` | `"3"` だけ成功。なしは IF_MATCH_REQUIRED（428）、ほかは INVALID_REQUEST（400） | 異常 | F-18、E-05、E-07 |
| U-13 | Idempotency-Key の解析 | なし | UUID、なし、UUID でない | UUID だけ成功。ほかは 400 | 異常 | E-09 |
| U-14 | request_hash | なし | キーの順序だけ違う body、前後の空白だけ違う名前、If-Match だけ違う、tripId だけ違う | 前 2 つは同じ hash、後 2 つは違う hash | 正常 | F-17 |
| U-15 | ApiErrorFilter | 各種の例外 | ApiError、M1 の Guard の例外、想定外の例外、DB 接続の失敗 | `{ code, message, requestId, retryable }`。想定外は 500 INTERNAL_ERROR でスタックを出さない。接続失敗は 503 retryable=true | 異常 | F-19 |
| U-16 | Zod の Pipe | 生成スキーマ | 未知の項目、型違い、絵文字 51 個（UTF-16 で 102）の名前、空の PATCH | 未知・型違い・空 PATCH は 400。絵文字 51 個は通過する（文字数は Domain で判定） | 境界 | E-15、B-01、B-08 |
| U-17 | 書き込みの流れの順序（UseCase） | インメモリの文脈 | receipt あり・hash 一致で If-Match が古い | 保存した結果を返し、VERSION_CONFLICT にしない（receipt が If-Match より先） | 正常 | F-17、N-11 |
| U-18 | 書き込みの流れ: hash 不一致 | receipt あり・hash 違い | 実行 | IDEMPOTENCY_KEY_REUSED。保存しない | 異常 | E-08 |
| U-19 | ロックの取り方 | インメモリの文脈 | 各 UseCase | 設計書「ロック順序」の表どおりのメソッドが、旅行 → 予定の順に呼ばれる | 正常 | 非機能 |
| U-20 | しおりの日付の既定 | Clock を固定 | 今日が期間内 / 期間前 / 期間後、日付を省略 | 期間内は今日、それ以外は初日（Asia/Tokyo。UTC の 15:00 をまたぐ時刻で確かめる） | 境界 | F-16 |

## 結合試験観点（実 DB）

### migration と権限（M2-a）

| # | 観点 | 前提 | 操作 | 期待結果 | 分類 | 要件 |
|---|---|---|---|---|---|---|
| D-01 | 空 DB への適用 | ロール作成済み | migrate | planning・record・infra の 8 表、索引、トリガーができる | 正常 | 受入 3 |
| D-02 | M1 適用済みの DB への適用 | 0000・0001 と identity のデータあり | migrate | 既存の行が変わらず、新しい表ができる | 正常 | 後方互換 |
| D-03 | 再適用 | D-01 の後 | もう一度 migrate | 変化なし | 冪等 | 受入 3 |
| D-04 | trips の制約 | なし | 名前が空白だけ、starts_on > ends_on、status=traveling で started_at が null、finished_at < started_at | それぞれ CHECK 違反 | 異常 | E-15 |
| D-05 | 参加者の制約 | 旅行あり | slot 2、同じ user を 2 回 | CHECK / UNIQUE 違反 | 境界 | F-01 |
| D-06 | plans の制約 | 旅行あり | 秒付きの時刻、cancelled_at だけ入れる、参加していない人の cancelled_by | CHECK / FK 違反 | 異常 | F-14 |
| D-07 | 追記のみ | plan_events・cancellations に行あり | migrator でも UPDATE / DELETE | トリガーで拒否（55000） | 異常 | F-21 |
| D-08 | app_runtime の必要な操作 | app_runtime で接続 | 各表の SELECT、trips・participants・plans・guards・receipts の INSERT、trips・plans の許可した列の UPDATE、trips・plans の FOR SHARE / FOR UPDATE / FOR NO KEY UPDATE | 成功（スキーマの USAGE も含めて確かめる） | 正常 | 受入 3 |
| D-09 | app_runtime で禁じる操作 | app_runtime | すべての表の DELETE、participants・receipts・guards の UPDATE、plan_events 系の INSERT、trips.created_by・plans.trip_id の UPDATE、DDL、TRUNCATE | 権限エラー | 異常 | E-20 |
| D-10 | allowlist のロック（差分 1 の根拠） | app_runtime | `SELECT … FROM identity.allowed_google_accounts FOR SHARE` | 権限エラー（ロックしない設計の根拠を固定する） | 異常 | 設計 |

### 旅行の API（M2-a）

| # | 観点 | 前提 | 操作 | 期待結果 | 分類 | 要件 |
|---|---|---|---|---|---|---|
| T-01 | 作成 | 二人が登録済み | POST /trips | 201、ETag `"1"`、Trip DTO。参加者 2 行（slot 0・1）、guard 1 行、receipt 1 行 | 正常 | F-01、F-02、N-01 |
| T-02 | 参加者が揃っていない | 1 人だけ登録 / 一方が enabled=false | POST /trips | 409 PARTICIPANTS_NOT_READY。表に何も増えない | 異常 | F-03、E-01 |
| T-03 | 途中で失敗したら全部戻る | guard の INSERT で失敗するよう注入 | POST /trips | 5xx。trips・参加者・guard・receipt のどれも残らない | 異常 | F-02、E-02 |
| T-04 | 同じキーの再送 | T-01 の後 | 同じキー・同じ body | 201、同じ DTO・ETag。行が増えない | 冪等 | F-17、N-11 |
| T-05 | 同じキーで body が違う | T-01 の後 | 同じキー・違う名前 | 409 IDEMPOTENCY_KEY_REUSED | 異常 | E-08 |
| T-06 | 同じキーの同時作成 | 2 接続 | 同じキー・同じ body を同時に | 旅行は 1 件。両方とも 201 と同じ id | 同時実行 | E-17 |
| T-07 | 一覧 | 自分の旅行 3 件、自分が参加しない旅行 1 件（テストで直接作る） | GET /trips | 自分の 3 件だけ、新しい順。同時刻は id の降順 | 正常 | F-04、N-02 |
| T-08 | 一覧のカーソルと絞り込み | 25 件 | limit=20 → nextCursor で続き、status=finished、limit=51、改ざんしたカーソル | 20 件 + 5 件で重複なし。絞り込みが効く。51 と改ざんは 400 | 境界 | F-04、B-06 |
| T-09 | 取得と 403 | 参加しない旅行、存在しない id | GET /trips/{id} | 200＋ETag。参加しない・存在しないはどちらも 403 TRIP_NOT_ACCESSIBLE で本文も同じ | 異常 | F-05、E-03 |
| T-10 | 名前の変更 | version 1 | PATCH（If-Match `"1"`） | 200、ETag `"2"` | 正常 | F-06、N-03 |
| T-11 | If-Match の欠落・古い値 | version 2 | If-Match なし / `"1"` | 428 IF_MATCH_REQUIRED / 409 VERSION_CONFLICT。名前は変わらない | 異常 | F-18、E-05、E-06 |
| T-12 | 期間の変更 | 取りやめ済みを含む予定あり | 全予定を含む期間 / 取りやめ済みの予定がはみ出す期間 | 成功 / 422 PLAN_OUTSIDE_TRIP_PERIOD で期間も予定も変わらない | 異常 | F-07、N-04、E-11 |
| T-13 | 開始と終了 | planning | start → finish | traveling と started_at / by、finished と finished_at / by | 正常 | F-08、N-05 |
| T-14 | 不正な遷移 | finished / planning | start / finish | 409 INVALID_TRIP_TRANSITION | 異常 | E-14 |
| T-15 | 同じ状態への遷移 | traveling・ETag 一致 | 別のキーで start | 200、version・started_at が変わらない。同じキーで再送しても同じ | 境界 | B-07 |
| T-16 | 終了後の操作 | finished | 名前・期間の変更、予定の追加・編集・移動・取りやめ | すべて成功 | 正常 | F-09、N-06 |
| T-17 | 形式・値の違反 | なし | 未知の項目、名前 101 文字、開始 > 終了、`2026-02-30`、Idempotency-Key なし | 400 / 422 / 422 / 422 / 400 | 異常 | E-09、E-15 |
| T-18 | Origin・Content-Type | M1 の Guard | 別 Origin の POST、text/plain | 403 / 415（エラーの形は `{ code, message, requestId, retryable }`） | 異常 | E-16、F-19 |

### 予定の API としおり（M2-b）

| # | 観点 | 前提 | 操作 | 期待結果 | 分類 | 要件 |
|---|---|---|---|---|---|---|
| P-01 | 追加 | 旅行あり | POST plans（時刻なし） | 201、ETag `"1"`、time=null、achievement / booking=null、canChangeKind=true | 正常 | F-10、N-07 |
| P-02 | 期間の外 | 期間 9/1〜9/3 | date=9/1、9/3、8/31、9/4 | 9/1・9/3 は成功、ほかは 422 PLAN_OUTSIDE_TRIP_PERIOD | 境界 | E-10、B-03 |
| P-03 | 取得と 404 | 別の旅行の予定、存在しない予定、参加しない旅行 | GET plans/{id} | 別の旅行の予定・存在しない予定は 404 PLAN_NOT_FOUND、参加しない旅行は 403 | 異常 | F-11、E-03、E-04 |
| P-04 | 部分更新 | version 1 | PATCH name / time=null / 同じ値 | 変更は version 2。同じ値は 200 で version 1 のまま | 正常 | F-12、N-08 |
| P-05 | 種類変更と履歴 | plan_events に取り消し済みの行を直接入れる | PATCH kind（ほかの項目も同時に） | 409 PLAN_HAS_RECORD_HISTORY。ほかの項目も変わらない。GET は canChangeKind=false・kindChangeReason=record_history_exists | 異常 | F-15、E-12 |
| P-06 | 履歴が無ければ変更できる | 履歴なし | PATCH kind | 成功 | 正常 | N-09 |
| P-07 | 日の移動 | 期間内 / 期間外 | move | 期間内は version が増える、期間外は 422 | 正常・異常 | F-13、E-10 |
| P-08 | 取りやめ | 未取りやめ | cancel、別のキーでもう一度、取りやめ後に memo を PATCH | cancelledAt / By が入る、2 回目は 409 PLAN_CANCELLED、PATCH は成功して取りやめのまま | 異常 | F-14、E-13 |
| P-09 | 予定の再送は元の DTO | 追加の後に相手が名前を変更 | 追加を同じキーで再送 | 201 と追加時点の DTO・ETag `"1"` | 冪等 | N-11 |
| P-10 | しおりの並び | 時刻あり・なし・同時刻、取りやめ済みを含む | GET itinerary?date= | 時刻順・未定は末尾・登録日時・id。取りやめ済みも入る | 正常 | F-16、N-10 |
| P-11 | しおりの日付 | 期間外の日付、省略 | GET itinerary | 期間外は 422。省略は U-20 の規則（Clock を固定した実アプリ） | 境界 | F-16 |
| P-12 | 有効な達成・予約の結合 | active_plan_events に行を直接入れる | GET plan、GET itinerary | achievement / booking に記録が入る。取り消し済み（active なし）は null | 正常 | F-22 |
| P-13 | 期間の変更と予定の追加の競合 | 2 接続 | 期間を 9/1〜9/2 に縮める要求と、9/3 に予定を追加する要求を同時に | どちらかが先に成立し、9/3 の予定と 9/1〜9/2 の期間が同時に成立しない | 同時実行 | E-18 |
| P-14 | 種類変更と記録の競合 | 2 接続 | 接続 A で予定行を FOR NO KEY UPDATE で持ったまま plan_events と active に行を入れて COMMIT、その間に接続 B で kind を PATCH | B は A の COMMIT を待ち、PLAN_HAS_RECORD_HISTORY になる | 同時実行 | E-19 |
| P-15 | 同じ予定の同時更新 | 2 接続・同じ If-Match | 名前の PATCH を同時に | 片方は成功、もう片方は 409 VERSION_CONFLICT | 同時実行 | E-06 |

## web の試験観点（M2-c・M2-d）

| # | 観点 | 前提 | 操作 | 期待結果 | 分類 | 要件 |
|---|---|---|---|---|---|---|
| W-01 | 入口: 前回の旅行が有効 | 保存値あり、GET trip が 200 | `/` を開く | `/trips/{id}/itinerary` へ | 正常 | F-23、N-13 |
| W-02 | 入口: 無効な保存値 | 保存値あり、GET trip が 403 | `/` を開く | `/trips` へ、保存値を消す | 異常 | B-09 |
| W-03 | 入口: 保存値なし・localStorage が使えない | なし / 例外を投げる | `/` を開く | `/trips` へ（例外で止まらない） | 境界 | F-23 |
| W-04 | ログアウトで保存値を消す | 保存値あり | ログアウト | その利用者のキーが消える | 正常 | F-23 |
| W-05 | 旅行 0 件 | listTrips が空 | `/trips` | 19 の空表示と「新しい旅行をつくる」 | 正常 | F-24 |
| W-06 | 旅行の作成のフォーム検証 | なし | 空白だけの名前、101 文字、絵文字 100 個、開始 > 終了 | 欄ごとのエラーと最初の欄へのフォーカス。絵文字 100 個は通る | 境界 | E-15、B-01 |
| W-07 | 保存中 | POST が保留 | 保存を 2 回押す | 1 回だけ送信、「保存中」 | 正常 | 保存状態 |
| W-08 | 結果不明 → 同じ要求 | 1 回目は network 失敗、2 回目は 201 | 保存 → 「同じ内容で確認する」 | C-4 が出て入力が固定される。2 回目の要求のキー・本文・If-Match が 1 回目と同じ | 異常 | E-21 |
| W-09 | 5xx も結果不明 | 503 | 保存 | C-4（保存失敗と断定しない） | 異常 | E-21 |
| W-10 | 拒否のあとは新しいキー | 422 → 入力を直す → 201 | 保存を 2 回 | 1 回目の欄のエラー、2 回目は別のキー | 異常 | F-17 |
| W-11 | 競合（C-5） | PATCH が 409 VERSION_CONFLICT、最新の GET は名前だけ違う | 保存 | 「相手が先に変更しました」、名前は「最新（相手）」と「あなたの入力」を並べ、違わない項目は 1 行。「あなたの入力で保存」は最新の ETag と新しいキーで送る | 異常 | E-22 |
| W-12 | ログイン切れ（C-1） | 401 | 保存・取得 | 業務データを隠して「もう一度ログインしてください」。結果不明のあとの 401 では「保存されたか確認できていません」の文も出る | 異常 | 設計 |
| W-13 | 開けない（C-2） | 403 / 404 | 旅行・予定を開く | 同じ文言「この旅行を開けません」/「この項目を開けません」と「旅行一覧へ」 | 異常 | E-03、E-04 |
| W-14 | 再取得の失敗 | 1 回目の取得は成功、2 回目は失敗 | 画面の復帰 | 前回の表示を残し「更新できていません」と取得時刻 | 異常 | F-27 |
| W-15 | オフライン（C-3） | navigator.onLine=false | 画面 | 帯と、保存につながるボタンが押せない | 異常 | F-27 |
| W-16 | しおりの表示 | 予定の各状態 | `/trips/{id}/itinerary?date=` | 時刻・時刻未定・取りやめ（色だけでなく文字とアイコン）・達成・予約 | 正常 | F-26 |
| W-17 | 期間外の日付の URL | 422 | 開く | 「旅行期間外です」と日付選択。勝手に別の日へ変えない | 境界 | F-16 |
| W-18 | 予定の追加 | 旅行あり | 名前・種類・時刻未定で保存 | 送る body の time が null、成功のトースト、しおりの再取得 | 正常 | F-10、N-12 |
| W-19 | 種類を変えられない予定の編集 | canChangeKind=false | 編集を開く | 種類の選択が固定され、理由の文が出る。ほかの項目は編集できる | 正常 | F-15 |
| W-20 | 日の移動 | 期間 3 日 | 同じ日を選ぶ / 別の日 | 同じ日は保存を押せない。別の日は移動し、旧日と新日のしおりを invalidate | 正常 | F-13 |
| W-21 | 取りやめの確認 | 未取りやめ | 取りやめ | ダイアログに名前・日付と「達成・予約・支払いの記録は残ります」。確定で cancel | 正常 | F-14 |
| W-22 | 旅行の終了の確認 | traveling | メニュー → 終了 | 17 の文言、墨のボタン。終了後もボタンを無効にしない | 正常 | F-08、F-09 |
| W-23 | 旅行名と期間の変更 | 両方を変える | 保存 | PATCH → PUT period の順に送る。期間が 422 なら名前は保存済みと表示し、期間の欄にエラー | 異常 | F-06、F-07 |
| W-24 | 入力中に再取得しても欄を置き換えない | 編集中に refetch で名前が変わる | フォーカスの復帰 | 入力欄は利用者の値のまま | 境界 | 設計 |
| W-25 | エラーの code だけを使う | 409 の本文に message・requestId | 保存 | 画面に message・requestId・code の文字列が出ない | 異常 | F-19 |

## 手動確認（M2-e）

| # | 観点 | 手順 | 期待結果 | 要件 |
|---|---|---|---|---|
| M-01 | 一連の操作（E2E で自動化: `e2e/tests/m01-flow.spec.ts`） | ひなたで旅行を作る → しおりで予定を 3 件（時刻なしを含む）→ 編集・移動・取りやめ → 開始 → 終了 → 終了後に予定を追加 | すべて画面どおりに反映される | N-12 |
| M-02 | 二人（E2E で自動化: `e2e/tests/m02-two-people.spec.ts`） | あおい（別プロファイル）でログインし、同じ旅行を開く。ひなたが名前を変えたあとに、あおいが古い画面から名前を変える | あおいに C-5 が出る | N-12、E-22 |
| M-03 | 前回の旅行（E2E で自動化: `e2e/tests/m03-selected-trip.spec.ts`） | ログアウト → ログイン | 旅行一覧へ（ログアウトで消えている）。旅行を選んでからブラウザを開き直すと、そのしおりへ | N-13 |
| M-04 | 結果不明（E2E で自動化: `e2e/tests/m04-unknown-result.spec.ts`） | 保存の直前に API を止める（`npm run dev` の api を停止） | C-4。API を戻して「同じ内容で確認する」で成功し、予定は 1 件だけ | E-21 |
| M-05 | v3 に無い画面のスクリーンショット | 旅行の作成、予定の追加・編集、日の移動、取りやめの確認、旅行名と期間の変更 | ユーザーが見た目を確認し、直しがあれば記録する | 受入 6 |
| M-06 | 375 幅 | ブラウザの幅を 375 にする | 横スクロールが出ない。長い旅行の日付バーだけが横に流れる | 非機能 |

## 試験対象と観点の対応

| 対象 | 観点 |
|---|---|
| BoundedText・LocalDate・LocalTime・TripPeriod | U-01〜U-07 |
| Trip・Plan | U-08〜U-11 |
| etag・idempotency-key・command-receipt | U-12〜U-14 |
| ApiErrorFilter・ZodBodyPipe | U-15、U-16 |
| 各 UseCase | U-17〜U-20、T・P |
| migration・GRANT・トリガー | D-01〜D-10 |
| trips.controller・plans.controller | T-01〜T-18、P-01〜P-15 |
| web の shared/api・features・screens | W-01〜W-25 |

## 回帰試験範囲

- M1 の全テスト（Guard・認証・CLI・web のサインイン）。エラー応答に requestId・retryable が増えるため、`code` だけを見ている既存テストは変えずに通ることを確かめる。
- foundation の HTTP・DB テスト（M2 では残す）。
- `npm run api:check`（Orval の再生成差分なし。web と api の両方の出力）。

## 試験データ

- 利用者: slot 0「ひなた」、slot 1「あおい」、第三者「そうた」（M1 と同じ架空の値）。
- 旅行: 「京都 2 泊」2026-09-01〜09-03（planning）、日帰り 2026-10-10〜10-10。
- 予定: 5 種類を 1 件ずつ、時刻 `09:00`・`09:00`（同時刻）・null、取りやめ済み 1 件。
- 絵文字の名前: `🍡` × 51（UTF-16 で 102）、× 100。
- Clock: 2026-09-01T14:59:00Z（日本時間 23:59）と 15:00:00Z（日本時間 9/2 00:00）。

## 完了条件

- U・D・T・P・W の全観点が自動テストで成功する。
- 要件の N-01〜13、E-01〜22、B-01〜09 がすべて下表でいずれかの観点に対応している。
- M-01〜M-06 の結果がログに記録されている（未実施の項目は未実施と明記）。
- lint / type-check / test / test:api-db / build / api:check がすべて成功する。

### 要件との対応表

| 要件 | 観点 |
|---|---|
| N-01 | T-01 |
| N-02 | T-07、T-08 |
| N-03 | T-10 |
| N-04 | T-12 |
| N-05 | T-13 |
| N-06 | T-16 |
| N-07 | P-01 |
| N-08 | P-04、P-07、P-08 |
| N-09 | P-06 |
| N-10 | P-10 |
| N-11 | U-17、T-04、P-09 |
| N-12 | W-18、M-01、M-02 |
| N-13 | W-01、M-03 |
| E-01 | T-02 |
| E-02 | T-03 |
| E-03 | T-09、P-03、W-13 |
| E-04 | P-03、W-13 |
| E-05 | U-12、T-11 |
| E-06 | T-11、P-15 |
| E-07 | U-12 |
| E-08 | U-18、T-05 |
| E-09 | U-13、T-17 |
| E-10 | P-02、P-07 |
| E-11 | T-12 |
| E-12 | U-10、P-05 |
| E-13 | U-11、P-08 |
| E-14 | U-08、T-14 |
| E-15 | U-02〜U-06、U-16、D-04、T-17、W-06 |
| E-16 | T-18 |
| E-17 | T-06 |
| E-18 | P-13 |
| E-19 | P-14 |
| E-20 | D-07、D-09 |
| E-21 | W-08、W-09、M-04 |
| E-22 | W-11、M-02 |
| B-01 | U-01、U-03、U-16、W-06 |
| B-02 | U-07 |
| B-03 | U-07、P-02 |
| B-04 | U-06 |
| B-05 | U-04 |
| B-06 | T-08 |
| B-07 | U-08、T-15 |
| B-08 | U-09、U-16 |
| B-09 | W-02 |
