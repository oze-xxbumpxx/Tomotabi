# 実装計画: devin-unlinked-pr-review

- 前提となる設計書: docs/designs/devin-unlinked-pr-review.md（未決事項1〜5は推奨どおりで実装）
- レベル: L2

## 手順

| # | 対象ファイル | 変更内容 | 完了条件 |
| --- | --- | --- | --- |
| 1 | `.claude/scripts/delegation.mjs` | `newSelfRecord`・`recordKey`・`targetArg`（`<Issue>` / `pr-<n>`）・`runnerFromAuthor`・`init pr-<n>`・`pr-<n>.yml`の読み書き・`origin`別の集計・分類のキーを委譲単位に。`DEFAULT_DIR`をexport | U-11〜U-14。既存のD-01〜D-12が通る |
| 2 | `.claude/scripts/wait-for-devin-pr.mjs` | `findUnlinkedDevinPrs`・`knownFromRecords`・`listOpenDevinPrs`・待機ループ | U-01〜U-09 |
| 3 | `.claude/hooks/find-devin-prs.mjs`・`.claude/settings.json` | SessionStartで未レビューのIssueなしDevin PRを促す。ghが無ければ何も出さない | F-01〜F-03 |
| 4 | `.claude/hooks/suggest-pr-watch.mjs` | `wait-for-devin-pr.mjs --since <今>`の起動を促す | U-10。既存のテストが通る |
| 5 | `.claude/skills/review-devin-pr/SKILL.md` | 「IssueなしPR」の節と、委譲の手順3の待機 | 手順が設計の観点表と一致 |
| 6 | `docs/claude-code/improvements/delegations/README.md`・`pr-53.yml`・`pr-54.yml` | 形式・語彙（`knowledge-inaccurate`・`harness-conflict`）・過去分 | `summary`が読める |
| 7 | `docs/devin-setup.md`・`AGENTS.md` | 自動レビューの説明 | — |

## 依存関係

1 → 2（記録の読み込みを使う）→ 3・4。5〜7は1〜4の後。

## 検証

`npm run test:harness`、`bash .claude/scripts/run-quality-gates.sh`。ghを使う部分（実際の検出）は、次のクラウド委譲で手動確認する。

## ロールバック

PRをrevertし、`delegations/pr-*.yml`も消す（revert後の`summary`は`pr-<n>.yml`を読まないので害は無いが、残す理由も無い）。
