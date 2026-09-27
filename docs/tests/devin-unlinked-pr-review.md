# 試験計画: devin-unlinked-pr-review

- 前提となる設計書: docs/designs/devin-unlinked-pr-review.md
- 対象: ハーネスのスクリプトとフック（アプリのコードは変えない）。`node --test` で純粋関数を固定し、gh は呼ばない。

| ID | 観点 | 種別 | テスト |
| --- | --- | --- | --- |
| U-01 | `devin/` 以外のブランチは対象外 | 正常 | wait-for-devin-pr.test.mjs |
| U-02 | 記録のある Issue に紐づく PR（本文・closingIssuesReferences・ブランチ末尾）は対象外 | 正常 | 同上 |
| U-03 | 末尾が数字でも記録の無い番号なら対象（#53・#54 のブランチ） | 境界 | 同上 |
| U-04 | 記録の無い Issue に紐づく PR は対象 | 境界 | 同上 |
| U-05 | since より前は対象外（ちょうどは対象） | 境界 | 同上 |
| U-06 | レビュー済みは対象外・複数は番号順 | 冪等 | 同上 |
| U-07 | 記録から委譲した Issue とレビュー済み PR を取り出す | 正常 | 同上 |
| U-08 | 出力の JSON 行 | 正常 | 同上 |
| U-09 | 引数の検査（--since 必須・ISO 8601）・exit 2 | 異常 | 同上 |
| U-10 | suggest-pr-watch が待機の起動を促す | 正常 | suggest-pr-watch.test.mjs |
| U-11 | Issue なし PR の記録の形・YAML の往復・closes_linked が null | 正常 | delegation.test.mjs |
| U-12 | `<Issue>` / `pr-<n>` の指定・作成者から実行場所 | 境界・異常 | 同上 |
| U-13 | CLI の init / review を pr-<n> で・重複 init はエラー | 冪等・異常 | 同上 |
| U-14 | 集計（Issue と PR の混在・委譲単位の数え方・起点別・Issue→PR から self を除く・Issue だけなら出力を変えない） | 回帰 | 同上 |
| F-01 | claude-review の印の判定 | 正常 | find-devin-prs.test.mjs |
| F-02 | 促す文の中身 | 正常 | 同上 |
| F-03 | gh が無い環境で何も出さず exit 0 | 障害 | 同上 |

## 回帰範囲

既存の delegation（D-01〜D-12）・wait-for-pr・suggest-pr-watch のテスト。`summary` の既存の出力（起点別の行は Issue なし PR の記録があるときだけ出る）。

## 手動の結合確認

次のクラウド委譲で Devin が知見の PR を出したら、`wait-for-devin-pr.mjs` かセッション開始時のフックで拾えるかを日次ログに書く。
