# 試験計画: expected-version-header

- 前提となる設計書: docs/designs/expected-version-header.md
- 対象: APIの版の読み方と予定・旅行のHTTP、画面の書き込みの要求と端末の記録。Vercelの層の動きは、結合検証環境で実機で確かめる。

| ID    | 観点                                                                                                                                            | 種別                 | テスト                                                         |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------- |
| EV-01 | `parseExpectedVersion`: `3`は`"3"`を返す。0・負・小数・引用符付き・前後の空白・カンマ区切り・空は400。無いときは428 `EXPECTED_VERSION_REQUIRED` | 正常・異常・境界     | `apps/api/tests/http/expected-version.test.ts`                 |
| EV-02 | 予定の編集・日の移動・取りやめが`X-Expected-Version`で通る。違う版は409、無いと428、If-Matchだけでも428                                         | 正常・異常           | `apps/api/tests/db/plans-http.db.test.ts`                      |
| EV-03 | 旅行の名前・期間の変更、開始、終了が`X-Expected-Version`で通る。無いと428                                                                       | 正常・異常           | `apps/api/tests/db/trips-http.db.test.ts`                      |
| EV-04 | 予定と旅行のGETにETagが付かない                                                                                                                 | 回帰                 | `plans-http.db.test.ts`・`trips-http.db.test.ts`               |
| EV-05 | 同じ`Idempotency-Key`の再送は、版の確認より先に元の結果を返す（今の試験を新しいヘッダーで通す）                                                 | 冪等性・回帰         | `plans-http.db.test.ts`・`trips-http.db.test.ts`               |
| EV-06 | `sendMutationRequest`は`x-expected-version`を付け、`if-match`を付けない。版の無い操作はどちらも付けない                                         | 正常・回帰           | `apps/web/tests/mutation-request.test.ts`                      |
| EV-07 | 端末の記録: 新しい記録は`expectedVersion`で残る。古い`ifMatch: "3"`の記録は`3`として読める。形の合わない`ifMatch`は壊れた記録として扱う         | 正常・移行・異常     | `apps/web/tests/pending-requests.test.tsx`                     |
| EV-08 | 予定と旅行の保存のあと、次の保存で本文の`version`を送る。conflictのあとの取り直しも本文の`version`を使う                                        | 正常                 | `apps/web/tests/plans-screens.test.tsx`・`save-state.test.tsx` |
| EV-09 | 結合検証環境で、予定の編集・日の移動・取りやめと、旅行の名前・期間の変更が成功として閉じる                                                      | 手動（結合検証環境） | デプロイ後に確かめる                                           |
