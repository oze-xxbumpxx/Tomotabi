# Tomotabi

@AGENTS.md

共通の開発ルールと現在のプロジェクト状態はAGENTS.mdに従う。
前回の作業はlogs/ の最新の日付ファイルを参照する。
日常のスキルは .claude/skills/、役割定義は .claude/agents/ に配置している。
人が読む文章（docs・ログ・Issue・PR・報告）を書くときは`shizen-nihongo`スキルを読み込み、`.claude/rules/writing-style.md`と合わせて使う。
ハーネスのフックは`.claude/settings.json`で設定済み。
他のエージェント（Devinなど）に渡すIssueを`gh issue create`したら、`.claude/scripts/wait-for-pr.mjs`でPRを待ち、`review-devin-pr`スキルでレビューする（フックが促す）。
