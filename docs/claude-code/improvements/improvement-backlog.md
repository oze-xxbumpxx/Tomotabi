# 改善バックログ

候補・提案の一覧。起票したら1行追加し、ステータスを更新する。
採番は`IMP-<西暦>-<連番3桁>`（`docs/claude-code/improvements/README.md`）。

| ID | タイトル | ステータス | 出典 | 更新日 |
| --- | --- | --- | --- | --- |
| IMP-2026-001 | 委譲のsecurity指摘（例外の中身が出力に出る）の予防を`devin-workflow`に足す | accepted | `candidates/delegation-security.md`（#31・#44）。PR #62で適用 | 2026-09-27 |
| IMP-2026-002 | 委譲のtest-path-mismatch指摘（テストが本番の経路を通っていない）の予防を`devin-workflow`に足す | accepted | `candidates/delegation-test-path-mismatch.md`（#31・#37・#59）。PR #66で適用。#69・#78の再発はmissing-testへの付け違いで、付け直すと適用後6委譲で0件（候補に追記） | 2026-09-29 |
| IMP-2026-003 | 委譲のmissing-test指摘（壊れても落ちないテスト・一部の経路だけの確認）の予防を`devin-workflow`に足す | accepted | `candidates/delegation-missing-test.md`（#44・#73・#78）。PR #82で適用。#85〜#125の7委譲で再発、#128からの12委譲は0件（候補に追記） | 2026-09-29 |
| IMP-2026-004 | 委譲のspec-mismatch指摘（設計書の表の正常系以外の行が抜ける）の予防として、PRの説明に表の行ごとの対応を書かせる | accepted | `candidates/delegation-spec-mismatch.md`（#73・#76・#80）。PR #94で適用済みだった。適用後は#111の1件だけ | 2026-10-08 |
| IMP-2026-005 | 委譲のrobustness指摘のうち、受け取る配列とたどるループの上限の漏れの予防を`devin-workflow`に足す | proposal | `candidates/delegation-robustness.md`（#78・#110・#125） | 2026-10-08 |
| IMP-2026-006 | 委譲のcoding-standard指摘（値なしに`undefined`）の予防として、`devin-workflow`にPATCHの例外の範囲を書く | proposal | `candidates/delegation-coding-standard.md`（#78・#110・#123） | 2026-10-08 |
| IMP-2026-007 | 委譲のui-glitch指摘（開けば分かる崩れ）の予防として、画面のPRで375幅で開いてv3と見比べさせる | proposal | `candidates/delegation-ui-glitch.md`（#76・#130・#142） | 2026-10-08 |
| IMP-2026-008 | 委譲のtest-robustness指摘（日付の決め打ち・クラス名・残った模擬）の予防を「既知の指摘」のE2Eの行にする | proposal | `candidates/delegation-test-robustness.md`（#100・#128・#152・#158） | 2026-10-08 |
| IMP-2026-009 | 委譲のdesign-gap・duplication・error-feedback・pr-metadata・scope-creepは、閾値に届いたがハーネスを変えず再発を見る | proposal | `candidates/delegation-design-gap.md`ほか4つ | 2026-10-08 |

accepted / rejected以外の行がsession-briefing / sprint-summaryの「未決定IMP」になる。
