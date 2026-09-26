# 実装計画: devin-delegation-loop

- 前提となる設計書: docs/designs/devin-delegation-loop.md（2026-09-26 ユーザー承認。未決事項はすべて推奨どおり）
- レベル: L2
- 実装ルート: Claude Code が直接実装（サブエージェントなし）
- 依存の追加: なし（Node 22 の標準モジュールだけ）

## 変更対象ファイル

| path | なぜ変えるか |
|---|---|
| `.claude/scripts/wait-for-pr-update.mjs`（新規） | 投稿後に PR の更新（新しい head → CI 完了）を待つ |
| `.claude/scripts/delegation.mjs`（新規） | 委譲の記録の init / review / finalize / summary |
| `.claude/tests/wait-for-pr-update.test.mjs`（新規） | 更新判定・CI 完了判定・引数の固定 |
| `.claude/tests/delegation.test.mjs`（新規） | YAML の往復・追記・finalize の組み立て・集計・昇格判定の固定 |
| `.claude/hooks/suggest-pr-watch.mjs` / `.claude/tests/suggest-pr-watch.test.mjs` | 促す文に `delegation.mjs init` を足す |
| `.claude/skills/review-devin-pr/SKILL.md` | 分類・自動投稿・再レビューのループ・上限・セキュリティの経路・記録 |
| `.claude/skills/close-session/SKILL.md` | 締めで `finalize` を実行し、記録をコミットに含める（設計のリスク対策） |
| `.claude/scripts/wait-for-pr.mjs` | `issueCreatedAt` / `listPrs` を export（finalize が PR を探すのに再利用） |
| `docs/claude-code/improvements/delegations/README.md`（新規） | 記録の形式・分類の語彙・昇格の閾値 |
| `docs/claude-code/improvements/delegations/{30,31,32,37,41}.yml`（新規） | 初期データ（model は不明なので unknown） |
| `docs/claude-code/improvement-cycle.md` | 「委譲ループの軽量サイクル」の節 |
| `AGENTS.md` | Devin の節に自動投稿と再レビューの約束を 1〜2 行 |
| `logs/2026-09-26.md` | 作業ログ |

## 手順

1. `wait-for-pr-update.mjs`: 純粋関数 `checksComplete(rollup)` / `ciConclusion(rollup)` / `detectUpdate(pr, since)` と CLI。完了条件: テストが通る。
2. `delegation.mjs`: 純粋関数 `toYaml` / `parseYaml`（本記録の形に限る）/ `newRecord` / `addReview` / `parseFinding` / `buildGhSection` / `summarize` / `formatSummary` と CLI。書き込みは一時ファイル → rename。完了条件: テストが通る。
3. フック・スキル・README・improvement-cycle・AGENTS.md を更新する。
4. 初期データを `init` → `review` → `finalize` の CLI で作る（CLI の結合確認を兼ねる）。
5. `npm run test:harness`、`bash .claude/scripts/run-quality-gates.sh`。
6. 作業ログ → コミット → PR。

## リスクとロールバック

- 自前の YAML パーサは、本記録の固定形（スカラー・ネストした map・map の配列・flow map の配列）に限る。その他の形は読まずにエラーにする。
- ロールバックは PR の revert。記録ファイルは残っても害がない。
