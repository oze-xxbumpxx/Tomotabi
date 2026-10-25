# ADR-0010: 管理Issueの共通受付をやめ、Issueを直接作って手元のDevinを起動する

- Status: Accepted（2026-10-25 ユーザーの判断）
- Date: 2026-10-25
- 置き換えるもの: ADR-0007

## Context（背景・なぜ判断が必要か）

ADR-0007で、委譲の状態を管理Issueのコメントに集め、GitHub Actionsの共通受付だけがIssueを作って起動を許す形にした。Claude Code・Codex・クラウドのDevinが別々の場所から同じタスクを任せないためだった。

2026-10-24〜25に、この受付で次のことが起きた。

- 受付のワークフローの実行が1177回になり、実行の一覧が読み取りの上限（1000件）に当たって、受付が毎回止まった（#285で直した）。
- 1件目の管理Issue（#191）のコメントが上限に達し、2件目（#267）に移っていた。使い続ける限り、また埋まる。
- 1回の処理に約40秒かかり、失敗は`communication_unknown`や`plan_unverified`としか出ない。原因は手元で再現しないとわからなかった。
- L1の計画を登録できなかった（#287で直した）。直したあとも、登録は`plan_unapproved`で断られた。

いまDevinを動かせるのは、この端末の手元のDevinだけで、同時に1つまでになっている（2026-10-12 クラウドの無料期間が終わったため）。二重の起動は、専用クローンのロックがすでに防いでいる。

## Decision（採用した決定）

1. タスクのIssueは、Claude Codeが`delegation.mjs open-task`で直接作る。本文の先頭に、どの計画のどのタスクかを示す印（タスク名と本文のdigest）を入れる。作る前に同じ印の開いたIssueを探し、同じタスクを二重に作らない。
2. 起動は今どおり、専用クローンのロックを取ってから`delegation-launch.mjs <Issue番号>`で手元のDevinを起動する。
3. PRを待つこと、レビュー、委譲の記録（`docs/claude-code/improvements/delegations/`）は、共通受付の前の形に戻す。レビューの完了は、現在headの完全SHAを入れたClaudeのコメントで示す。
4. 共通受付のワークフロー（`delegation-control.yml`・`delegation-events.yml`）、受付の部品（`delegation-control.mjs`・`delegation-shared.mjs`・`delegation-github.mjs`）、agent-reviewのチェック（`agent-review.mjs`）を消す。管理Issue（#267）は閉じる。

## Alternatives（検討した非採用案と却下理由）

| 案 | 選ばなかった理由 |
| --- | --- |
| 受付を残し、上限や決まりを1つずつ直す | 上限に当たるたびに受付が止まり、そのたびにDevinへの委譲が止まる。手元のDevin1つだけの使い方には仕組みが大きすぎる |
| 管理Issueの代わりに専用ブランチのJSONで状態を持つ | 書き込みの権限と状態用ブランチの運用が増える。いまの使い方では、二重の起動はロックで防げている |

## Consequences（結果）

- 良い面: 委譲が受付の待ちと失敗で止まらない。失敗の理由は手元のコマンドの出力でわかる。
- 悪い面: クラウドのDevinやCodexを別の場所から起動すると、二重の起動は防げない。使い始めるときに、起動の手順と二重起動の防ぎ方を作り直す（`cloud_launch_verified:false`のあいだはクラウドの起動を止めている）。
- 悪い面: 最終版のレビューを必須チェックで止める仕組みが無くなる。マージ前に、Claudeの完了のコメントのSHAと現在headが同じことを確かめる手順で補う。
