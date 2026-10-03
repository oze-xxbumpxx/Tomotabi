# 改善バックログ

候補・提案の一覧。起票したら1行追加し、ステータスを更新する。
採番は`IMP-<西暦>-<連番3桁>`（`docs/claude-code/improvements/README.md`）。

| ID | タイトル | ステータス | 出典 | 更新日 |
| --- | --- | --- | --- | --- |
| IMP-2026-001 | 委譲のsecurity指摘（例外の中身が出力に出る）の予防を`devin-workflow`に足す | accepted | `candidates/delegation-security.md`（#31・#44）。PR #62で適用 | 2026-09-27 |
| IMP-2026-002 | 委譲のtest-path-mismatch指摘（テストが本番の経路を通っていない）の予防を`devin-workflow`に足す | accepted | `candidates/delegation-test-path-mismatch.md`（#31・#37・#59）。PR #66で適用。#69・#78の再発はmissing-testへの付け違いで、付け直すと適用後6委譲で0件（候補に追記） | 2026-09-29 |
| IMP-2026-003 | 委譲のmissing-test指摘（壊れても落ちないテスト・一部の経路だけの確認）の予防を`devin-workflow`に足す | accepted | `candidates/delegation-missing-test.md`（#44・#73・#78）。PR #82で適用。事後評価は #85から | 2026-09-29 |
| IMP-2026-004 | 委譲のspec-mismatch指摘（設計書の表の正常系以外の行が抜ける）の予防として、PRの説明に表の行ごとの対応を書かせる | proposal | `candidates/delegation-spec-mismatch.md`（#73・#76・#80） | 2026-09-29 |

accepted / rejected以外の行がsession-briefing / sprint-summaryの「未決定IMP」になる。
