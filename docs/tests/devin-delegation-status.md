# 試験計画: devin-delegation-status

- 前提となる設計書: docs/designs/devin-delegation-status.md
- 対象: ハーネスのスクリプトとフック（アプリのコードは変えない）。`node --test`で純粋関数を固定し、ghは呼ばない（ghの応答は固定のJSONで与える）。

| ID | 観点 | 種別 | テスト |
| --- | --- | --- | --- |
| S-01 | `follow_up_of`は任意。Issue番号と`pr-<n>`を受け付け、不正な値はエラー。YAMLで往復できる | 正常・異常 | delegation.test.mjs |
| S-02 | `reviewed_at`は任意。指定したときだけ`round`の次に入る。CLIのreviewは既定で今の時刻を入れる | 正常 | 同上 |
| S-03 | 写し: `writeRecord`が写しにも書く。写しの書き込みに失敗しても正は書け、警告だけ出す。CLIで`--dir`を指定したときは写さない | 正常・障害 | 同上 |
| S-04 | 正と写しの統合: 正だけ・写しだけ・両方（reviewsの多い方 → outcomeのある方 → 正） | 境界 | 同上 |
| S-05 | summary: 後続を生んだ・後続なしの一発合格の数え方。`follow_up_of`の無い記録 | 正常 | 同上 |
| S-06 | summaryの「後続の委譲」の行は、後続があるときだけ出す（今までの出力を変えない） | 回帰 | 同上 |
| S-07 | 次の動き: 完了済み（merged / closed）は出さない | 正常 | delegation-status.test.mjs |
| S-08 | 次の動き: PRがMERGED / CLOSED → finalize | 正常 | 同上 |
| S-09 | 次の動き: 紐づくPRが無い → PR待ち。経過時間。8時間を超えたら注記 | 境界 | 同上 |
| S-10 | 次の動き: PRあり・reviewsが空 → 初回レビュー前（IssueなしPRの中断も同じ） | 正常 | 同上 |
| S-11 | 次の動き: headが最後のreviewed_shaと違う → 再レビュー（round n+1） | 正常 | 同上 |
| S-12 | 次の動き: fixでheadが同じ → 修正待ち（`--since`はreviewed_at、無ければdelegated_at。ローカルは注記）。escalate / merge → ユーザー待ち | 正常・境界 | 同上 |
| S-13 | PRの特定: `pr`・`gh.pr`・`findLinkedPr`。番号は分かるが一覧に無い → ghで確かめられない | 境界 | 同上 |
| S-14 | 未起票の昇格候補: candidateで`delegation-<category>.md`が無ければ出す、あれば出さない | 正常 | 同上 |
| S-15 | 写しの掃除: 完了から30日を過ぎたものだけ。完了していない・日時の無いものは消さない | 境界 | 同上 |
| S-16 | 表示: 1委譲1行。PRのタイトルは改行を落として切る。出す行が無ければ空。ghが無いときは記録上の最後の状態と注記 | 正常・障害 | 同上 |
| S-17 | 待機（wait-for-devin-pr）: 記録があるPRは、reviewsが空でも既知（`--exclude`が要らない） | 正常 | wait-for-devin-pr.test.mjs |
| S-18 | 待機の引数: `--exclude`は受け付けない（exit 2） | 異常 | 同上 |
| S-19 | フック: 出す行があればSessionStartのadditionalContext、無ければ何も出さない | 正常 | delegation-status.test.mjs |
| S-20 | フック: ghが無い環境でもexit 0 | 障害 | 同上 |

## 回帰範囲

- 既存のdelegation（D-01〜D-12・U-11〜U-14）・wait-for-devin-pr（U-01〜U-08・U-15・U-16）・wait-for-pr・suggest-pr-watchのテスト。
- 実際の記録12件で`summary`が読め、「後続の委譲: 3/10」が出ること。
- find-devin-prsのテスト（F-01〜F-03）の観点はS-16・S-19・S-20に移す。

## 手動の結合確認

次のローカルの委譲で、委譲した直後にセッションを閉じ、別のworktreeで始めたセッションの開始時に「PR待ち」が出ることを確かめる。その後、PRができてから始めたセッションで「初回レビュー前」が出ることも確かめる。結果を日次ログに書く。
