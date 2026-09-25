---
name: devin-workflow
description: >
  Devin が Tomotabi でタスクを受けてから PR を出すまでの手順。ブランチ名・変更レベルの判定・
  品質確認・やってはいけないこと・作業ログを定める。Devin のセッションでだけ使う。
  Claude Code と Codex は使わない（それぞれ AGENTS.md の入口に従う）。
---

# Devin の作業手順

共通のルールは `AGENTS.md`。この手順は、Devin に無い仕組み（Claude Code のフック）の代わりと、Devin 固有の約束だけを書く。役割分担と背景は `docs/devin-setup.md`。

## 1. 着手する前

1. `AGENTS.md` と、`logs/` の最新の日付ファイルを読む。
2. `.agents/skills/classify-change/SKILL.md` で変更レベル（L0〜L3）を判定する。
   - L0 / L1（文言、テスト追加、lint 修正、小さな修正）: そのまま進める。
   - L2 / L3（複数モジュール、API・DB スキーマの変更、新機能）: `docs/designs/` の設計書がユーザーに承認されていなければ、実装しない。設計案を示して止まる。
   - 技術スタック・アーキテクチャの決定（ADR 級）: 候補と比較を示すところまで。決めるのはユーザー。
3. `main` から `devin/<内容>` のブランチを切る。他のツール（Claude Code の `claude/`、Codex など）が使っているブランチには push しない。

## 2. 実装

- コーディング規約は `.claude/rules/coding-standards.md`（`any` 禁止、名前付きエクスポート、`import type`、値なしは `null`）。
- テストは各 workspace の `tests/` に置き、`src/` の構造をミラーする。
- 依頼の範囲外のリファクタリングはしない。気づいたことは PR の説明に書く。
- 存在しない設計書・コマンド・レビュー結果をあるものとして扱わない。

## 3. PR を出す前の品質確認

次をすべて通す。

```bash
npm run lint
npm run type-check
npm test
npm run build
```

- API 契約を変えたら `npm run api:check`、DB スキーマを変えたら `npm run db:check` も通す。
- `npm run test:api-db` は Docker が必要。VM で動かなければ CI の `api-db` ジョブに任せ、PR に「未確認」と書く。
- `.claude/scripts/run-quality-gates.sh` は pnpm 固定のため使わない。
- 通らないテストをスキップ・無効化して CI を通さない。

## 4. PR

- タイトルは既存に合わせる（`feat:` / `fix:` / `docs:` + 日本語）。
- 説明に「変更レベルと、ユーザー承認: 必要 / 不要」「何を・なぜそう設計したか・別の方法との比較」「実行した品質確認と結果」を書く。L1 の説明は 3 行以内の要約でよい。
- マージはユーザーが行う。Devin はマージしない。

## 5. 作業ログ

`logs/YYYY-MM-DD.md`（当日）に、やったこと・検証結果・未完了を追記して PR に含める。ファイルが無ければ `write-work-log` スキルの形で作る。「AI ツール活用記録」に `Devin: <依頼内容と結果>` を 1 行で書く。他のツールが書いた内容は消さない。

## やってはいけないこと

次はユーザーの確認なしに実行しない。

- `main` への直接 push、履歴の書き換え（force push）、ブランチの削除
- データの削除、migration の本番適用、本番環境への操作
- `.env` や秘密情報のコミット（`.env.example` に本番の値を書かない）
- `.claude/`・`.agents/`・`AGENTS.md`・`CLAUDE.md` の変更（ハーネスの構成。変えるなら PR で理由を書き、重点レビューを依頼する）
- Cursor 用の `.cursor/rules/` の手順（pstack）に従うこと。Devin には pstack が無い。
