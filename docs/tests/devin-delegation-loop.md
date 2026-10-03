# 試験計画: devin-delegation-loop

- 前提となる設計書: docs/designs/devin-delegation-loop.md
- レベル: L2

## 試験種別

- 単体: `node --test .claude/tests/*.test.mjs`（ghは呼ばない。純粋関数と引数検査）
- 結合（手動）: 初期データをCLIの`init` / `review` / `finalize`（実gh）で作り、`summary`を表示する
- 実運用の確認: 次の委譲1本でループを1周回す（#43・#44は対象外）。結果は日次ログへ

## 単体試験観点

| # | 対象 | 観点 | 期待結果 | 分類 |
|---|---|---|---|---|
| W-01 | wait-for-pr-update | headのコミット時刻がsinceより前 | 未更新 | 正常 |
| W-02 | 〃 | sinceより後のheadでCI実行中 | 未更新 | 正常 |
| W-03 | 〃 | sinceより後のheadでCI完了（成功） | 更新あり・success | 正常 |
| W-04 | 〃 | 〃（失敗を含む） | 更新あり・failure | 正常 |
| W-04b | 〃 | 想定外の結論（STALE・null）とStatusContextのSUCCESS以外 | failure（成功扱いはSUCCESS / SKIPPED / NEUTRALだけ） | 異常 |
| W-09 | 〃 | 投稿前に作ったコミットを投稿後にpush | --shaより後ろで数える。SHAが無ければ時刻で数える | 境界 |
| W-05 | 〃 | チェックが0件 | 完了とみなす（none） | 境界 |
| W-06 | 〃 | PRがCLOSED / MERGED | closed | 正常 |
| W-07 | 〃 | StatusContext（PENDING / SUCCESS）とCheckRunの混在 | PENDINGがあれば未完了 | 境界 |
| W-08 | 〃 | 引数の誤り（PR番号なし・sinceが日時でない・未知のオプション） | exit 2 | 異常 |
| D-01 | delegation | 記録のYAML書き出し → 読み戻しが一致（null・真偽・数値・`:`や`'`を含む文字列） | 一致 | 正常 |
| D-02 | 〃 | 想定外の形のYAML | エラー | 異常 |
| D-03 | 〃 | initのmodelの値の制限・重複作成 | 不正なmodelはエラー・既存があればエラー | 異常 |
| D-04 | 〃 | reviewの追記と同じroundの重複 | 追記される・重複はエラー | 正常/異常 |
| D-05 | 〃 | findingの解析（summaryに`:`を含む・未知のseverity） | 3つに分かれる・エラー | 境界/異常 |
| D-06 | 〃 | securityのsummary | `(非公開)`に置き換える | 正常 |
| D-07 | 〃 | finalizeのgh応答から`gh:`とoutcomeを作る。CIの初回はPR作成時のhead | pr・時刻・commits・ci_first_pass・closes_linked・merged/closed/open。まとめてpushしたら最後のコミット | 正常/境界 |
| D-08 | 〃 | 集計: モデル別の件数・一発合格・平均round・CI初回成功・所要時間の中央値 | 期待値どおり | 正常 |
| D-09 | 〃 | 分類の数え方: 同じIssueで複数回出ても1件 | 1件 | 境界 |
| D-10 | 〃 | 昇格候補: 3件で候補・2件は候補外・securityは2件で候補 | 期待どおり | 境界 |
| D-11 | 〃 | 記録0件 | 空の集計 | 境界 |
| D-12 | init / summary | runnerの既定local・cloudの指定・不正な値・runnerの無い古い記録 | local / cloud / exit 2 / unknownとして集計 | 正常・異常 |
| H-01 | suggest-pr-watch | 促す文に`delegation.mjs init <n>` | 含まれる | 正常 |

## 完了条件

- 上の観点がすべてテストにあり、`npm run test:harness`が成功する。
- 品質ゲート（`run-quality-gates.sh`）が成功する。
