# Tomotabi

@AGENTS.md

共通の開発ルールと現在のプロジェクト状態は AGENTS.md に従う。
前回の作業は logs/ の最新の日付ファイルを参照する。
日常のスキルは .claude/skills/、役割定義は .claude/agents/ に配置している。
ハーネスのフックは .claude/settings.json で設定済み。
他のエージェント（Devin など）に渡す Issue を `gh issue create` したら、`.claude/scripts/wait-for-pr.mjs` で PR を待ち、`review-devin-pr` スキルでレビューする（フックが促す）。
