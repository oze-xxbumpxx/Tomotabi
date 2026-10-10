# 委譲とレビュー連携の実機確認

管理Issueは[#191](https://github.com/oze-xxbumpxx/Tomotabi/issues/191)。controllerは380285943、listenerは380164771。GitHub APIでworkflow名・パス・有効状態と、要求担当者のID109064833を確認した。

## 初期化の順序

1. 管理Issueとworkflow IDの設定PRをユーザーがmainへマージする。
2. mainのdelegation-controlへoperation=initializeを1回だけdispatchする。開始前に既存のActions作成コメントとdispatch履歴を再照合する。
3. 成功したrunの結果とActions作者の先頭コメントを照合し、anchor_comment_idを別の設定PRへ保存する。POST結果不明なら再送せず、管理Issueとrunを読む。
4. 既存タスクの対応をimport要求として用意し、初期化済みの共通受付へ送る。実行元・モデル・セッションは確認できたものだけ記録する。

管理Issueの作成時点ではdispatch履歴は0件。初期化後もmigration_completeとcli_launch_verifiedはfalseを維持する。初期化をPRブランチや手作業のコメントで代用しない。

## 既存タスクの照合

2026-10-10にGitHubのOPEN PRとIssue、ローカルの委譲記録を読み取った。ローカルの未追跡記録は編集・移動・コミットしていない。

| Issue | PR | 現在head | 確認状況 |
| --- | --- | --- | --- |
| 180 | 183 | db200413e8c110409cfa25157b6d6102eb4a425b | OPEN、main向け。セッション対応は未確認 |
| 181 | 184 | b175beedf1690ab704aac8134cf94cd0171c6f7e | OPEN、main向け。セッション対応は未確認 |
| 182 | 185 | a62e89bb6550e7daa19232d8b62d679a6219e941 | OPEN、main向け。セッション対応は未確認 |
| 188 | 189 | 49f622396a67117d74644251aa3a2435283869f6 | OPEN、旧実装ブランチ向け。一部の修正はmainのPR190に反映済み。閉じ方はユーザー判断 |

PRの本文には各Issueを閉じる対応が記載されている。ローカル記録のレビューは共有ゲートの現在head完了証拠へ自動変換しない。上表は移行要求ではなく、移行前の照合記録である。task_keyと作業本文のdigestは承認済み計画と照合してから確定する。

## 試運転で確認すること

- 起動スタブで同じ要求の再送と、beginの再配送が二重spawnにならないこと。
- 確認用PRで現在headへの明示checkが付くこと。片方のレビューが不足すれば成功にしないこと。
- Claudeの完了投稿とGitHubのCodexレビューを確認し、両方が揃った場合だけ成功になること。
- 修正push後に古い成功を使わず、現在headへ再レビューを要求すること。
- API障害時に未確認と表示し、古い成功表示だけでマージしないこと。

試験目的のDevin起動は行わない。Rulesetの必須チェック追加と停止設定の解除は、実機確認後にユーザーが判断する。

## Actionsでの初期化結果

設定PR192はmainへマージ済み。2026-10-10にinitializeを1回dispatchし、[run38034392026](https://github.com/oze-xxbumpxx/Tomotabi/actions/runs/38034392026)が成功した。実行SHAは12a0d1abb7fd8327abb71282045c1c9c3678b8f9で、マージ済みmainと一致する。

先頭コメントIDは6095103226、作者IDはActionsの41898282。管理Issueのコメント一覧で該当する先頭コメントが1件だけであることを確認した。last_seqは0、last_event_idはnull、last_hashは64桁の0。runのanchor_initializedの出力と一致する。

先頭コメントIDの設定PRをマージするまで通常要求は送らない。初期化を再dispatchする必要はない。既存委譲のimportと実機レビュー検証は未実施。

## 既存タスクの移行結果

PR193のマージ後、共有履歴をオンラインで取得できた。公開の要求JSONはdelegation-review-imports/に保存した。既存計画には新方式のタスクmarkerがないため、移行時のdigestは各Issue本文の改行をLFへそろえたUTF-8文字列のSHA-256とした。計画markerからの新規登録とは区別し、plan_path／plan_shaとセッション・モデルの申告は送っていない。元の委譲記録は変更していない。

| Issue | task_key | 結果 | 要求コメント | 実行run |
| --- | --- | --- | --- | --- |
| 180 | `push-notifications:signout-guard` | `imported` | 6095229736 | 38035359284 |
| 181 | `push-notifications:dispatch` | `imported` | 6095230011 | 38035359284 |
| 182 | `push-notifications:settings-screen` | `imported` | 6095230261 | 38035359284 |
| 188 | `delegation-review-reliability:pr187-followup` | `pr_link_unverified` | 6095230490 | 38035359284 |

3件の通知タスクはverified_issue／verified_prがtrue、stateがpr_open、importedがtrueとなった。start_conditions_confirmedはfalseで、attempt／caller／activation／sessionはnull、requested_model／observed_modelはunknown。起動許可は発行されていない。

Issue188の要求はpr_link_unverifiedで拒否された。PR189の本文にはCloses #188があるが、GraphQLのclosingIssuesReferencesは0件だった。旧実装ブランチ向けのPRであり、本文だけを関連付けの証拠として通さない。再送・PRのbase変更・クローズは行っていない。ユーザーの整理判断後に再照合する。migration_completeとcli_launch_verifiedはfalseを維持する。

## レビュー不足の実機確認

mainのreview-refreshをPR183・184・185へ各1回dispatchした。3つのActionsはsuccessで終了し、各現在headのagent-reviewはcompleted／failureになった。これは制御処理の失敗ではなく、レビュー証拠が不足するPRを成功にしない判定である。

| PR | 制御run | check ID | 判定 |
| --- | --- | --- | --- |
| 183 | 38035403582 | 114164782190 | failure |
| 184 | 38035405243 | 114164886967 | failure |
| 185 | 38035407156 | 114164994933 | failure |

次はClaude側で各PRの現在headと指摘を実際にレビューし、GitHubのCodex完了証拠と合わせてreview-devin-prの完了JSONを新規投稿する。Codex側のローカルレビューを、GitHubのCodex bot完了やClaude完了に置き換えない。投稿後にreview-refreshし、共有状態とlive checkの成功を照合する。

両レビュー後のsuccess、修正push後の無効化、同じSHAのPR集約、CLI内部の再送設定とセッション形式はまだ実機未確認。必須チェック設定と起動許可を解除しない。

## チェック更新と不要な起動の修正

実機の繰り返し確認でcheck_write_unknownが発生した。実装と試験fixtureは、statusだけをin_progressに変更すると古いconclusionが消える前提だった。完了済みcheckを再照合する際はcompleted/action_requiredを明示して旧successを取り消す。共有状態はin_progress／nullを維持する。証拠が不明な最終結果もlive checkをaction_requiredにし、成功証拠に使わない。Checks APIに書けない場合のstale_success警告と停止は維持する。

controllerのworkflow_runはdelegation-eventsだけに絞る。既存CI・E2Eはレビュー判定の入力ではなく、独立した品質ゲートのため、その完了による再確認を外す。通常のコメントではwriterを省略する。管理Issueの要求marker、PRのCodex作者と完了markerを対象にし、編集前のmarkerも確認する。PRのライフサイクル・レビュー・行コメントのlistener通知と毎時の再照合は維持する。

通常コメントでもGitHubにskippedのworkflow履歴が残る場合はある。今回減らすのはrunner上のwriter処理とCI完了からの追加workflowであり、履歴が必ず0件になるとは保証しない。修正の実機再確認は設定PRのマージ後に行う。

PRコメントの削除は本文や作者情報の有無に依存せずwriterを起動する。通常コメントの追加・編集は省略できるが、削除は証拠の消失を取りこぼさないため再照合する。
