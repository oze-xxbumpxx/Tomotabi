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
