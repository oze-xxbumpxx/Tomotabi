---
name: quality-gates
description: >
  品質ゲート（lint / type-check / test、オプションで format チェック・build）を一括実行し、
  PASS / FAIL / SKIP を集計して報告する手順。「品質ゲートを回して」「ゲート確認して」
  「lint とテストをまとめて実行」と依頼されたとき、および実装タスクの完了確認
  （definition-of-done.md のゲート）で使う。実体は .claude/scripts/run-quality-gates.sh。
---

# 品質ゲート一括実行

## 手順

1. 実在するゲートを確認する（擬似コマンドを作らない）:

   ```bash
   .claude/scripts/detect-project-commands.sh
   ```

2. ゲートを実行する:

   ```bash
   .claude/scripts/run-quality-gates.sh            # 既定: harness + lint + type-check + test
   .claude/scripts/run-quality-gates.sh --format   # + prettier --check
   .claude/scripts/run-quality-gates.sh --build    # + build
   .claude/scripts/run-quality-gates.sh --all      # 全部（休眠中の review-readiness 試験も含む）
   ```

3. スクリプトの集計（PASS / FAIL / SKIP）をそのまま報告する。FAIL があれば該当出力を添え、
   `[unavailable]` のゲートは unknown として報告する（勝手に代替コマンドをでっち上げない）。

## 備考

- パッケージマネージャーは lockfile（pnpm / yarn / bun / npm）から検出する。無い script は SKIP。
- ハーネス試験は `test:harness` が無ければ `node --test .claude/tests/*.test.mjs`。
  既定は休眠中の `review-readiness.test.mjs` を除く。全件確認は `--all` か
  `node --test .claude/tests/*.test.mjs`。
- アプリの pre-commit は未導入。本スキルが手動確認と完了報告の手段。
