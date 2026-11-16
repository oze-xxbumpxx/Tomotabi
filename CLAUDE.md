# Tomotabi

@AGENTS.md

共通の開発ルールと現在の状態はAGENTS.md。前回の作業はlogs/の最新。
機能の追加・修正は`develop-feature`スキルをこのセッションで進める。子エージェントは検証（`reviewer`、条件を満たすとき`security-reviewer`）と、広い探索（`Explore`）だけ。
人が読む文章は`shizen-nihongo`スキルと`.claude/rules/writing-style.md`。
設計の選択や不具合の原因調べなど、ユーザーに選んでもらう検討を1枚の画面にまとめるときは`visualize-decision`スキルを読む。子エージェントは増やさない。
フックは`.claude/settings.json`。危険な操作はフックが止める。
Devinへ渡したIssueのあとは`.claude/scripts/wait-for-pr.mjs`と`review-devin-pr`スキル。
