# 試験計画: devin-unlinked-pr-review

- 前提となる設計書: docs/designs/devin-unlinked-pr-review.md
- 対象: ハーネスのスクリプトとフック（アプリのコードは変えない）。`node --test`で純粋関数を固定し、ghは呼ばない。

| ID | 観点 | 種別 | テスト |
| --- | --- | --- | --- |
| U-01 | `devin/`以外のブランチは対象外 | 正常 | wait-for-devin-pr.test.mjs |
| U-02 | 記録のあるIssueに紐づくPR（本文・closingIssuesReferences・ブランチ末尾）は対象外 | 正常 | 同上 |
| U-03 | 末尾が数字でも記録の無い番号なら対象（#53・#54のブランチ） | 境界 | 同上 |
| U-04 | 記録の無いIssueに紐づくPRは対象 | 境界 | 同上 |
| U-05 | sinceより前は対象外（ちょうどは対象） | 境界 | 同上 |
| U-06 | レビュー済みは対象外・複数は番号順 | 冪等 | 同上 |
| U-07 | 記録から委譲したIssueとレビュー済みPRを取り出す。initだけで中断した記録（reviewsが空）はレビュー済みにしない | 正常・障害 | 同上 |
| U-08 | 出力のJSON行 | 正常 | 同上 |
| U-09 | 引数の検査（--since必須・ISO 8601・--exclude）・exit 2 | 異常 | 同上 |
| U-10 | suggest-pr-watchが待機の起動を促す | 正常 | suggest-pr-watch.test.mjs |
| U-11 | IssueなしPRの記録の形・YAMLの往復・closes_linkedがnull | 正常 | delegation.test.mjs |
| U-12 | `<Issue>` / `pr-<n>`の指定・作成者から実行場所 | 境界・異常 | 同上 |
| U-13 | CLIのinit / reviewをpr-<n> で・重複initはエラー | 冪等・異常 | 同上 |
| U-14 | 集計（IssueとPRの混在・委譲単位の数え方・起点別・Issue→PRからselfを除く・Issueだけなら出力を変えない） | 回帰 | 同上 |
| U-15 | claude-reviewの印の判定（待機とフックで共通） | 正常 | wait-for-devin-pr.test.mjs |
| U-16 | 印のあるPRを除き、コメント取得の失敗はPRごとにuncheckedに分ける | 障害 | 同上 |
| F-01 | 取得できなかったPRも「未確認」として出す | 障害 | find-devin-prs.test.mjs |
| F-02 | 促す文の中身 | 正常 | 同上 |
| F-03 | ghが無い環境で何も出さずexit 0 | 障害 | 同上 |

## 回帰範囲

既存のdelegation（D-01〜D-12）・wait-for-pr・suggest-pr-watchのテスト。`summary`の既存の出力（起点別の行はIssueなしPRの記録があるときだけ出る）。

## 手動の結合確認

次のクラウド委譲でDevinが知見のPRを出したら、`wait-for-devin-pr.mjs`かセッション開始時のフックで拾えるかを日次ログに書く。
