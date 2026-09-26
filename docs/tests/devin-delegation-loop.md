# 試験計画: devin-delegation-loop

- 前提となる設計書: docs/designs/devin-delegation-loop.md
- レベル: L2

## 試験種別

- 単体: `node --test .claude/tests/*.test.mjs`（gh は呼ばない。純粋関数と引数検査）
- 結合（手動）: 初期データを CLI の `init` / `review` / `finalize`（実 gh）で作り、`summary` を表示する
- 実運用の確認: 次の委譲 1 本でループを 1 周回す（#43・#44 は対象外）。結果は日次ログへ

## 単体試験観点

| # | 対象 | 観点 | 期待結果 | 分類 |
|---|---|---|---|---|
| W-01 | wait-for-pr-update | head のコミット時刻が since より前 | 未更新 | 正常 |
| W-02 | 〃 | since より後の head で CI 実行中 | 未更新 | 正常 |
| W-03 | 〃 | since より後の head で CI 完了（成功） | 更新あり・success | 正常 |
| W-04 | 〃 | 〃（失敗を含む） | 更新あり・failure | 正常 |
| W-04b | 〃 | 想定外の結論（STALE・null）と StatusContext の SUCCESS 以外 | failure（成功扱いは SUCCESS / SKIPPED / NEUTRAL だけ） | 異常 |
| W-09 | 〃 | 投稿前に作ったコミットを投稿後に push | --sha より後ろで数える。SHA が無ければ時刻で数える | 境界 |
| W-05 | 〃 | チェックが 0 件 | 完了とみなす（none） | 境界 |
| W-06 | 〃 | PR が CLOSED / MERGED | closed | 正常 |
| W-07 | 〃 | StatusContext（PENDING / SUCCESS）と CheckRun の混在 | PENDING があれば未完了 | 境界 |
| W-08 | 〃 | 引数の誤り（PR 番号なし・since が日時でない・未知のオプション） | exit 2 | 異常 |
| D-01 | delegation | 記録の YAML 書き出し → 読み戻しが一致（null・真偽・数値・`:` や `'` を含む文字列） | 一致 | 正常 |
| D-02 | 〃 | 想定外の形の YAML | エラー | 異常 |
| D-03 | 〃 | init の model の値の制限・重複作成 | 不正な model はエラー・既存があればエラー | 異常 |
| D-04 | 〃 | review の追記と同じ round の重複 | 追記される・重複はエラー | 正常/異常 |
| D-05 | 〃 | finding の解析（summary に `:` を含む・未知の severity） | 3 つに分かれる・エラー | 境界/異常 |
| D-06 | 〃 | security の summary | `(非公開)` に置き換える | 正常 |
| D-07 | 〃 | finalize の gh 応答から `gh:` と outcome を作る。CI の初回は PR 作成時の head | pr・時刻・commits・ci_first_pass・closes_linked・merged/closed/open。まとめて push したら最後のコミット | 正常/境界 |
| D-08 | 〃 | 集計: モデル別の件数・一発合格・平均 round・CI 初回成功・所要時間の中央値 | 期待値どおり | 正常 |
| D-09 | 〃 | 分類の数え方: 同じ Issue で複数回出ても 1 件 | 1 件 | 境界 |
| D-10 | 〃 | 昇格候補: 3 件で候補・2 件は候補外・security は 2 件で候補 | 期待どおり | 境界 |
| D-11 | 〃 | 記録 0 件 | 空の集計 | 境界 |
| H-01 | suggest-pr-watch | 促す文に `delegation.mjs init <n>` | 含まれる | 正常 |

## 完了条件

- 上の観点がすべてテストにあり、`npm run test:harness` が成功する。
- 品質ゲート（`run-quality-gates.sh`）が成功する。
