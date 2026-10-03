# 実装計画: devin-delegation-loop

- 前提となる設計書: docs/designs/devin-delegation-loop.md（2026-09-26ユーザー承認。未決事項はすべて推奨どおり）
- レベル: L2
- 実装ルート: Claude Codeが直接実装（サブエージェントなし）
- 依存の追加: なし（Node 22の標準モジュールだけ）

## 変更対象ファイル

| path | なぜ変えるか |
|---|---|
| `.claude/scripts/wait-for-pr-update.mjs`（新規） | 投稿後にPRの更新（新しいhead → CI完了）を待つ |
| `.claude/scripts/delegation.mjs`（新規） | 委譲の記録のinit / review / finalize / summary |
| `.claude/tests/wait-for-pr-update.test.mjs`（新規） | 更新判定・CI完了判定・引数の固定 |
| `.claude/tests/delegation.test.mjs`（新規） | YAMLの往復・追記・finalizeの組み立て・集計・昇格判定の固定 |
| `.claude/hooks/suggest-pr-watch.mjs` / `.claude/tests/suggest-pr-watch.test.mjs` | 促す文に`delegation.mjs init`を足す |
| `.claude/skills/review-devin-pr/SKILL.md` | 分類・自動投稿・再レビューのループ・上限・セキュリティの経路・記録 |
| `.claude/skills/close-session/SKILL.md` | 締めで`finalize`を実行し、記録をコミットに含める（設計のリスク対策） |
| `.claude/scripts/wait-for-pr.mjs` | `issueCreatedAt` / `listPrs`をexport（finalizeがPRを探すのに再利用） |
| `docs/claude-code/improvements/delegations/README.md`（新規） | 記録の形式・分類の語彙・昇格の閾値 |
| `docs/claude-code/improvements/delegations/{30,31,32,37,41}.yml`（新規） | 初期データ（modelは不明なのでunknown） |
| `docs/claude-code/improvement-cycle.md` | 「委譲ループの軽量サイクル」の節 |
| `AGENTS.md` | Devinの節に自動投稿と再レビューの約束を1〜2行 |
| `logs/2026-09-26.md` | 作業ログ |

## 手順

1. `wait-for-pr-update.mjs`: 純粋関数`checksComplete(rollup)` / `ciConclusion(rollup)` / `detectUpdate(pr, since)`とCLI。完了条件: テストが通る。
2. `delegation.mjs`: 純粋関数`toYaml` / `parseYaml`（本記録の形に限る）/ `newRecord` / `addReview` / `parseFinding` / `buildGhSection` / `summarize` / `formatSummary`とCLI。書き込みは一時ファイル → rename。完了条件: テストが通る。
3. フック・スキル・README・improvement-cycle・AGENTS.mdを更新する。
4. 初期データを`init` → `review` → `finalize`のCLIで作る（CLIの結合確認を兼ねる）。
5. `npm run test:harness`、`bash .claude/scripts/run-quality-gates.sh`。
6. 作業ログ → コミット → PR。

## リスクとロールバック

- 自前のYAMLパーサは、本記録の固定形（スカラー・ネストしたmap・mapの配列・flow mapの配列）に限る。その他の形は読まずにエラーにする。
- ロールバックはPRのrevert。記録ファイルは残っても害がない。
