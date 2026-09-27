# 実装計画: devin-delegation-status

- 前提となる設計書: docs/designs/devin-delegation-status.md（2026-09-27 承認。未決事項 1〜5 は推奨どおり）
- レベル: L2

## 手順

| # | 対象ファイル | 変更内容 | 完了条件 |
| --- | --- | --- | --- |
| 1 | `.claude/scripts/delegation.mjs` | `newRecord` の `followUpOf`（任意。`targetArg` で検査）、`addReview` の `at`（任意。`reviewed_at`）、`writeRecord` の写し（`mirrorDir`。失敗は警告だけ）、`defaultMirrorDir`、`mergeRecords`・`readKnownRecords`、summary の「後続なしの一発合格」「後続を生んだ」と「後続の委譲」の行、CLI の `init --follow-up-of`・`review --reviewed-at`（既定は今）・`--mirror-dir`（`--dir` を指定したときの既定は写しなし）、`status` の動的読み込み | S-01〜S-06。既存の D-01〜D-12・U-11〜U-14 が通る（D-08 は列の追加に合わせて期待を更新） |
| 2 | `.claude/scripts/delegation-status.mjs` | 新規。`nextAction`・`findPromotions`・`prunableMirrorKeys`・`buildStatus`・`formatStatus`（純粋関数）と、gh の取得・写しの掃除・CLI（`--json`・`--no-gh`） | S-07〜S-16 |
| 3 | `.claude/scripts/wait-for-devin-pr.mjs` | `--exclude` を削除。`knownFromRecords` は記録がある PR をすべて既知にする。記録は `readKnownRecords`（正 ∪ 写し）で読む | S-17・S-18。U-01〜U-06・U-08・U-15・U-16 が通る |
| 4 | `.claude/hooks/delegation-status.mjs`・`.claude/settings.json`、`find-devin-prs.mjs` とテストの削除 | SessionStart で status を出す。出す行が無ければ何も出さない。gh が無くても exit 0 | S-19・S-20 |
| 5 | `.github/ISSUE_TEMPLATE/devin-task.md` | 委譲用の Issue テンプレート | 設計書の節と一致 |
| 6 | `.claude/skills/review-devin-pr/SKILL.md`・`close-session/SKILL.md`・`docs/claude-code/improvement-cycle.md`・`delegations/README.md` | 委譲節（テンプレート・`--follow-up-of`・既知の指摘の表）、Issue なし PR の手順 1（`--exclude` をやめる）、セッション開始時の表示、close の 3a、予防の置き場、記録の項目と写し | 手順が設計と一致 |
| 7 | `delegations/43.yml`・`48.yml`・`55.yml` | `follow_up_of`（37・44・51）を `readRecord` / `writeRecord` で入れる | `summary` に「後続の委譲: 3/10」 |

## 依存関係

1 → 2（記録の読み書きと summary を使う）→ 3（`readKnownRecords`）→ 4（2 を使う）。5〜7 は 1〜4 の後。

## 検証

`npm run test:harness`、`bash .claude/scripts/run-quality-gates.sh`。gh を使う部分（実際の PR の状態）は、このコンテナに gh が無いため、次のローカルの委譲で手動確認する（試験計画の「手動の結合確認」）。

## ロールバック

PR を revert する。写しのディレクトリ（`~/.local/state/tomotabi-harness/delegations/`）は残っても害が無い（消してよい）。
