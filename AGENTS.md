# Tomotabi 開発ルール

Claude Code と Codex は、このリポジトリの同じハーネス・成果物・ログを利用する。

## 現在の状態

- アプリ本体は未実装。言語・フレームワーク・DB・アーキテクチャは未決定。
- Cookpit 由来の文書にある Next.js、DDD、pnpm、Vitest、導入済み CI などは Tomotabi の採用事実ではない。
- スタック固有の規約は該当技術を採用した場合だけ適用する。存在しない設計書・コマンド・レビュー結果をあるものとして扱わない。

## 作業の進め方

1. 作業開始時に `git status` と `logs/` の最新ログを読み、実装済み・未完了を確認する。
2. `.claude/skills/classify-change/SKILL.md` を参照して変更規模を判断する。必要な設計・計画・検証・レビューは `docs/claude-code/` と該当スキルを参照する。
3. 小さな修正は直接進める。ユーザーが既に依頼した範囲のファイル追加や通常作業で再承認を求めない。
4. 品質コマンドは実在するものだけ実行し、未導入のゲートは `unknown` と報告する。ハーネス自身のテストは `node --test .claude/tests/*.test.mjs`。
5. 終了時は変更・検証・未完了事項を `logs/YYYY-MM-DD.md` に記録する。他方のツールが残した変更を上書きせず、同じファイルを同時編集しない。

## ツールごとの入口

- Claude Code: `CLAUDE.md`、`.claude/skills/`、`.claude/agents/`、`.claude/settings.json` のフックを使う。
- Codex: 本ファイルと `.agents/skills/` から共通スキルを読む。`.claude/agents/` は役割の参考資料であり、Codex のエージェント登録ではない。Claude Code のフックは Codex では自動実行されない。
- Codex でハーネスの状態を扱うコマンドには `HARNESS_NAMESPACE=tomotabi-harness` を付け、リポジトリルートで実行する。Claude Code には同じ値を settings の env で設定している。
- スキルから参照される Cookpit 専用文書・専用スキルが無い場合は、本ファイルと実際の構成を使う。未採用の技術や架空の成果物を補わない。

導入元・更新時の注意は `docs/harness-setup.md` を参照。
