# 実装計画: delegation-journal-rollover

- 前提となる設計書: docs/designs/delegation-journal-rollover.md（PR #225、2026-10-24 チャットで承認）
- 試験計画: docs/tests/delegation-journal-rollover.md
- 変更レベル: L2。ハーネスだけを変え、アプリのコードは触らない。
- 実装ルート: Orchestrator（メインの会話が直接書く）。判断理由: 変える関数が3つに絞れていて、試験の偽のGitHubもそろっているため。

## 手順

| 順  | 対象                     | すること                                                                                                                                                                        | 完了条件                                                 |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | 新しい管理Issue          | Claude Codeが作る（#267、2026-10-24 02:35 UTC）                                                                                                                                 | Issueがある                                              |
| 2   | `delegation-control.mjs` | `persistEvent`の最初で、要求に結び付かず変更が今の状態と同じイベントを書かない（`unchangedInternalEvent`）。`initializeAnchor`は、管理Issueの作成時刻より前の手動実行を数えない | 試験計画のJR-01〜JR-06が通る                             |
| 3   | `delegation-shared.mjs`  | `readIssueComments`で900件を超えたら、1回の実行につき1回`::warning::`を出す                                                                                                     | JR-07が通る                                              |
| 4   | 設定とworkflow（PR1）    | `management_issue`を267、`anchor_comment_id`を0にし、workflowの`if`の番号を267にする                                                                                            | JR-08が通る。ハーネスの全試験が通る                      |
| 5   | 初期化                   | PR1のマージ後、ユーザーが`delegation-control`を手動で実行する（operation: initialize）                                                                                          | 実行の出力に`anchor_initialized`と先頭コメントのIDが出る |
| 6   | 先頭コメントのID（PR2）  | 5で出たIDを`anchor_comment_id`に書く                                                                                                                                            | マージ後の`delegation-control`が通る                     |
| 7   | #191                     | 新しい管理Issueへのリンクをコメントする（#191はもうクローズ済み）                                                                                                               | コメントがある                                           |

## 依存関係

2〜4は同じPR（PR1）に入れる。5はPR1がmainに入ってから（workflowはmainのコードで動く）。6は5のIDが要る。7は6のあと。

## リスクと戻し方

- PR1のマージから6のマージまで、定期実行は`uninitialized`で止まる。今も落ちているので、悪くはならない。
- 戻すときは、設定とworkflowの番号を#191と元の先頭コメントID（6095103226）に戻す。#191は上限に達したままなので、戻しても落ちる。
