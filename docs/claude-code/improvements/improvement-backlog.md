# 改善バックログ

候補・提案の一覧。起票したら 1 行追加し、ステータスを更新する。
採番は `IMP-<西暦>-<連番3桁>`（`docs/claude-code/improvements/README.md`）。

| ID | タイトル | ステータス | 出典 | 更新日 |
| --- | --- | --- | --- | --- |
| IMP-2026-001 | 委譲の security 指摘（例外の中身が出力に出る）の予防を `devin-workflow` に足す | accepted | `candidates/delegation-security.md`（#31・#44）。PR #62 で適用 | 2026-09-27 |
| IMP-2026-002 | 委譲の test-path-mismatch 指摘（テストが本番の経路を通っていない）の予防を `devin-workflow` に足す | accepted | `candidates/delegation-test-path-mismatch.md`（#31・#37・#59）。PR #66 で適用。適用後に #69・#78 で再発（候補に追記） | 2026-09-29 |
| IMP-2026-003 | 委譲の missing-test 指摘（壊れても落ちないテスト・一部の経路だけの確認）の予防を `devin-workflow` に足す | proposal | `candidates/delegation-missing-test.md`（#44・#73・#78） | 2026-09-29 |

accepted / rejected 以外の行が session-briefing / sprint-summary の「未決定 IMP」になる。
