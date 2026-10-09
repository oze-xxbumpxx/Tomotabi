# ADR-0007: GitHubで委譲状態を共有し、最終版のレビューを必須にする

- Status: Proposed（主要3方針はユーザー選択済み。設計PRの承認待ち）
- Date: 2026-10-09
- 関連 feature: delegation-review-reliability

## Context（背景・なぜ判断が必要か）

ローカルとCloudが同じ作業を別々に起票し、Devinの重複開発が起きた。現行のリポジトリ内YAMLとマシン内の写しでは、進行中の委譲を環境間で共有できない。起票前の検索だけでは同時実行の競合を防げない。

Codexレビューの完了記録は、調査したDevin作成PR12件中1件だった。その1件もレビュー対象と最終headが違った。既存CIの成功だけでは、最終版の両レビューと指摘への対応を確認できない。

## Decision（採用した決定）

1. 共有状態は固定の管理用Issueの制御workflowによるbotコメントに集める。要求を消えないコメントに残し、Actionsの単一writerが履歴・版・hashと実行元を確認して更新する。
2. Issue作成とDevin委譲受付はActionsの共通窓口へ集約する。波と独立したtask_keyと作業本文digestを使い、同じキーの内容変更は競合として止める。
3. 同じhead SHAのOPEN PRに対し、対象PR全件のClaude・Codex完了と対象指摘の確認をagent-reviewで判定し、必須チェックにする。作者と編集者を別に照合する。対象外PRにも同じcontextを出すが、SHAを共有する対象PRの確認を待つ。既存必須CIは別に維持する。

この3方針は2026-10-09にユーザーが選択した。初回は担当を確保した1つのラッパーが既存Devin CLIを1回呼ぶ提案とし、設計PRで承認を受ける。結果不明の起動は自動解放・自動やり直しをしない。新しいDevin APIキー、後続の完全自動起動、Merge Queueは追加しない。

## Alternatives（検討した非採用案と却下理由）

| 案 | 選ばなかった理由 |
| --- | --- |
| 専用GitブランチのJSONで状態を共有する | 更新競合をrefで検出できるが、現在の規模ではcontents書き込み権限と状態用ブランチの運用を増やさず、GitHub画面から読める管理Issueを選んだ |
| 直接起票・直接起動を残し、作成後に重複を検知する | 検知時点でIssueとセッションが二重にできるため、作成前の共通受付を選んだ |
| レビュー不足を表示するだけにする | 最終版を確認していないPRの見落としを防ぐため、通常のマージを必須チェックで止める |
| 初回からActionsがDevin APIで起動する | 手渡しを減らせるが、新しいAPI認証と実環境の確認が必要になる。初回は既存CLIを使い、曖昧な起動結果を止めて照合する案を承認対象にする |

詳しい比較とユーザーの回答は[論点の記録](../discussions/delegation-review-reliability.md)に残す。

## Consequences（良い影響・悪い影響・残るリスク）

- 良い影響: ローカルとCloudが同じ委譲を照合でき、同時の要求を共通の受付で扱える。PRの最終版のレビュー証拠を確認できる。
- 悪い影響: ActionsとGitHubの共有状態を取得できない間は、起票・起動・通常のマージを待つ。起動の応答喪失では、人の照合が必要になる。
- 残るリスク: 外部起動のexactly-onceは保証しない。GitHubイベントの非同期配送、コメント履歴の上限、Codex summaryの形式変更、書き込み資格情報の侵害への限界が残る。
- 公開範囲: リポジトリはpublic。管理Issueに公開計画参照とID・digest・状態・証拠URLだけを残し、指摘本文、raw prompt、生ログ、秘密を写さない。

## Migration（移行が必要な場合の手順。不要なら「対象外」）

設計承認後に実装し、実装PRをユーザーがマージする。管理Issueを初期化し、進行中のIssue・PR・セッションをimportしてから共通受付へ切り替える。既存YAMLの履歴は保持し、未登録を未着手と推測しない。

確認PRでagent-reviewの成功・不足証拠・head更新・対象外を試す。動作確認後にProtect-mainへagent-reviewを追加する。quality・build・api-dbは維持する。Codexの設定とbotからの依頼は、実機確認まで成立条件にしない。

## Rollback（決定を戻す場合の手順）

新しい受付と起動を止め、管理Issueの履歴を保持して進行中の試行を照合する。unknownの担当を自動解放せず、共有状態をYAMLへ写して引き継ぐ。レビュー必須化を戻す場合はユーザーの判断でProtect-mainからagent-reviewだけを外し、既存CIを維持する。

コードを戻すだけで直接起動を再開しない。進行中のセッションを確認してからユーザーが運用を選ぶ。管理Issue・履歴・外部セッションの削除、mainの履歴改変は行わない。

## References（設計書・要件・関連 ADR・外部資料へのリンク）

- [要件定義](../requirements/delegation-review-reliability.md)、[設計書](../designs/delegation-review-reliability.md)、[既存の委譲状態の設計](../designs/devin-delegation-status.md)
- [2026-10-09の調査](../../logs/2026-10-09.md)
- [GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)、[REST APIの推奨事項](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
- [GitHub workflow runs](https://docs.github.com/en/rest/actions/workflow-runs)、[PR reviews](https://docs.github.com/en/rest/pulls/reviews)、[PRイベントとmerge commit](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)
- [コメントの編集権限](https://docs.github.com/en/communities/moderating-comments-and-conversations/managing-disruptive-comments#editing-a-comment)、[必須チェックとcommit SHA](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)
- [CodexのGitHubレビュー](https://learn.chatgpt.com/docs/third-party/github)
