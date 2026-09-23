# 試験計画: m0-validation-result-client

- 前提となる設計書: docs/designs/m0-validation-result-client.md
- レベル: L2

## 試験種別

- 単体: mutator（fetch を stub）、`callApi`、`probe-api`、`useProbe` / `ProbePanel`（Testing Library）
- 型: 生成型と contracts 公開型の双方向互換（Vitest の `expectTypeOf`）
- 生成再現性: `npm run api:check`（再生成して差分なし）
- 結合: 既存の API HTTP テスト（変更なしで成功すること）
- E2E: 対象外（Playwright 未導入）

## 単体試験観点

| # | 観点 | 前提 | 操作 | 期待結果 | 分類 |
|---|---|---|---|---|---|
| V-01 | GET の送り方 | fetch 成功 | `getProbe()` | `/api/foundation/probes`、GET、credentials include、no-store | 正常 |
| V-02 | POST の送り方 | fetch 成功 | `incrementProbe()` | `/api/foundation/probes/increment`、POST、content-type application/json、body なし | 正常 |
| V-03 | count 0 を受理 | `{count:0}` | `getProbe()` | Ok(0) | 境界 |
| V-04 | 正の整数を受理 | `{count:4}` | `getProbe()` | Ok(4) | 正常 |
| V-05 | 負数 | `{count:-1}` | `getProbe()` | Err(validation) | 異常 |
| V-06 | 小数 | `{count:1.5}` | `getProbe()` | Err(validation) | 異常 |
| V-07 | 文字列 | `{count:"4"}` | `getProbe()` | Err(validation)（数値へ変換しない） | 異常 |
| V-08 | 欠損・null | `{}` / `{count:null}` | `getProbe()` | Err(validation) | 異常 |
| V-09 | 不正 JSON | 本文 `not json` | `getProbe()` | Err(invalid-json) | 異常 |
| V-10 | 空の成功応答 | 本文 `""` | `getProbe()` | Err(invalid-json) | 境界 |
| V-11 | 非 2xx | 500 | `getProbe()` | Err(http, 500) | 異常 |
| V-12 | 通信失敗 | fetch reject | `getProbe()` | Err(network)。未処理 rejection なし | 異常 |
| V-13 | 追加プロパティ | `{count:1, extra:true}` | `getProbe()` | Ok(1)（厳格化しない） | 境界 |
| V-14 | 画面: 取得成功 | V-04 | 描画 | 「現在の件数: 4」 | 正常 |
| V-15 | 画面: 加算成功 | 取得 4 → 加算 5 | ボタン押下 | 「現在の件数: 5」、ボタンが再び押せる | 正常 |
| V-16 | 画面: 加算で検証失敗 | 取得 4 → 加算 `{count:-1}` | ボタン押下 | エラー文言。count は 4 のまま保持、pending 解除 | 異常 |
| V-17 | 画面: 取得の通信失敗 | fetch reject | 描画 | 「通信できませんでした」。0 件と表示しない | 異常 |
| V-18 | 型互換 | なし | 型テスト | 生成 `ProbeView` ⇔ contracts `ProbeView` が相互に代入可能 | 正常 |

## 回帰範囲

- 既存 web テスト（http-client、probe-panel）は新しい API に合わせて置き換える。観点（Cookie 送信、失敗表示、件数表示）は維持する。
- API 側は変更しない。既存 HTTP テスト 27 件が成功すること。

## 完了条件

- V-01〜V-18 が自動テストで成功する。
- lint / type-check / test / build / api:check が成功する。test:api-db は API 未変更のため任意（実行した場合は結果を記録）。
