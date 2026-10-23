# 実装計画: expected-version-header

- 前提となる設計書: docs/designs/expected-version-header.md（2026-10-23承認、PR #264）
- 試験計画: docs/tests/expected-version-header.md
- 変更レベル: L2。APIと画面と契約を同じPRで変える。
- 実装ルート: Orchestrator（メインの会話が直接書く）。判断理由: 原因を調べて設計を書いた会話の続きで、変える場所を一覧済みのため。

## 手順

| 順  | 対象                                                                                                                                        | すること                                                                                                                                                                     | 完了条件                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | 契約（`packages/contracts/openapi/planning.json`・`trips.json`、`src/plan.ts`・`src/trip.ts`）                                              | `IfMatch`の引数を`ExpectedVersion`（`X-Expected-Version`、`^[1-9][0-9]*$`）に置き換える。428の説明とエラーの名前、GETの`ETag`の定義を直す。`npm run api:generate`            | 生成コードが新しいヘッダーの名前になる           |
| 2   | API（`common/http/etag.ts` → `expected-version.ts`、`api-error.filter.ts`、`api-error.ts`、予定と旅行のコントローラー、`configure-app.ts`） | `parseExpectedVersion`を置き、コントローラーは`x-expected-version`を読む。GETのETagを消す。エラーの名前を`EXPECTED_VERSION_REQUIRED`にする。コメントを確かめた事実に合わせる | `npm run type-check`が通る                       |
| 3   | 画面（`mutation-request.ts`・`pending-requests.ts`・`api-failure.ts`・`api-result.ts`・予定と旅行のAPIの関数・保存・画面の部品）            | `ifMatch`を`expectedVersion`（数字だけの文字列）に変え、`x-expected-version`で送る。版は本文の`version`から取る。古い`ifMatch`の記録は読むときに直す                         | `npm run type-check`が通る                       |
| 4   | 試験（`apps/api/tests`・`apps/web/tests`・`e2e`）                                                                                           | ヘッダーの名前と値を直し、試験計画の観点を足す                                                                                                                               | `npm test`と`npm run test:api-db`（CI）が通る    |
| 5   | 資料                                                                                                                                        | 設計資料・要件・試験計画・ADR-0004・用語集のIf-Matchの記述を直す                                                                                                             | `if-match`の検索で残るのが、経緯の記述だけになる |
| 6   | 確かめ                                                                                                                                      | 品質ゲートとbuild、`api:check`                                                                                                                                               | すべて通る                                       |

受領票の`request_hash`に入れる項目の名前（`ifMatch`）と、書き込みの流れ（usecase）の`ifMatch`の名前は変えない。名前を変えると、デプロイの前に受けた要求の再送で`request_hash`が合わなくなるため。中身は前から版の数字だけ。

## 依存関係

1の生成コードを2と3が使うので、1を先にする。2と3は互いに依存しない。4は2と3のあと。

## リスクと戻し方

- 名前の変更が広いので、最後に`if-match`・`ifMatch`・`etag`を検索して、残りを確かめる。
- 戻すときは、このPRを戻して出し直す。DBは変えないので、データの戻しは要らない。
