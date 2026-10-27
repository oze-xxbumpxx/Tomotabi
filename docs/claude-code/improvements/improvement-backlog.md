# 改善バックログ

候補・提案の一覧。起票したら1行追加し、ステータスを更新する。
採番は`IMP-<西暦>-<連番3桁>`（`docs/claude-code/improvements/README.md`）。

| ID | タイトル | ステータス | 出典 | 更新日 |
| --- | --- | --- | --- | --- |
| IMP-2026-001 | 委譲のsecurity指摘（例外の中身が出力に出る）の予防を`devin-workflow`に足す | accepted | `candidates/delegation-security.md`（#31・#44）。PR #62で適用 | 2026-09-27 |
| IMP-2026-002 | 委譲のtest-path-mismatch指摘（テストが本番の経路を通っていない）の予防を`devin-workflow`に足す | accepted | `candidates/delegation-test-path-mismatch.md`（#31・#37・#59）。PR #66で適用。#69・#78の再発はmissing-testへの付け違いで、付け直すと適用後6委譲で0件（候補に追記） | 2026-09-29 |
| IMP-2026-003 | 委譲のmissing-test指摘（壊れても落ちないテスト・一部の経路だけの確認）の予防を`devin-workflow`に足す | accepted | `candidates/delegation-missing-test.md`（#44・#73・#78）。PR #82で適用。#85〜#125の7委譲で再発、#128からの12委譲は0件（候補に追記） | 2026-09-29 |
| IMP-2026-004 | 委譲のspec-mismatch指摘（設計書の表の正常系以外の行が抜ける）の予防として、PRの説明に表の行ごとの対応を書かせる | accepted | `candidates/delegation-spec-mismatch.md`（#73・#76・#80）。PR #94で適用済みだった。適用後は#111の1件だけ | 2026-10-08 |
| IMP-2026-005 | 委譲のrobustness指摘のうち、受け取る配列とたどるループの上限の漏れの予防を`devin-workflow`に足す | accepted | `candidates/delegation-robustness.md`（#78・#110・#125）。2026-10-08にユーザーが採用し、同じブランチで適用 | 2026-10-08 |
| IMP-2026-006 | 委譲のcoding-standard指摘（値なしに`undefined`）の予防として、`devin-workflow`にPATCHの例外の範囲を書く | accepted | `candidates/delegation-coding-standard.md`（#78・#110・#123）。2026-10-08にユーザーが採用し、同じブランチで適用 | 2026-10-08 |
| IMP-2026-007 | 委譲のui-glitch指摘（開けば分かる崩れ）の予防として、画面のPRで375幅で開いてv3と見比べさせる | accepted | `candidates/delegation-ui-glitch.md`（#76・#130・#142）。2026-10-08にユーザーが採用し、同じブランチで適用 | 2026-10-08 |
| IMP-2026-008 | 委譲のtest-robustness指摘（日付の決め打ち・クラス名・残った模擬）の予防を「既知の指摘」のE2Eの行にする | accepted | `candidates/delegation-test-robustness.md`（#100・#128・#152・#158）。2026-10-08にユーザーが採用し、同じブランチで適用 | 2026-10-08 |
| IMP-2026-009 | 委譲のdesign-gap・duplication・error-feedback・pr-metadata・scope-creepは、閾値に届いたがハーネスを変えず再発を見る | proposal | `candidates/delegation-design-gap.md`ほか4つ | 2026-10-08 |
| IMP-2026-010 | 委譲のlogging-gapは閾値に届いたが型が2つ（認証の経路のログ漏れ2件・`catch`で原因を捨てる2件）に分かれるので、ハーネスを変えず再発を見る。`catch`の型が3件目になったら、`devin-workflow`に例外の種類だけを残す1行を足す | proposal | `candidates/delegation-logging-gap.md`（#37・#43・#180・#181）。2026-10-10に分類を付け直して閾値を超えた | 2026-10-11 |
| IMP-2026-011 | 委譲のtest-flakiness指摘（並行の順番や乱数の値を確定させずに確かめる試験）の予防を`devin-workflow`に足す | proposal | `candidates/delegation-test-flakiness.md`（#117・#125・#211） | 2026-10-27 |

accepted / rejected以外の行がsession-briefing / sprint-summaryの「未決定IMP」になる。

## 留め置き（昇格せず、再発を見る）

振り返りで昇格条件を満たさなかった知見。同じ型が再び起きたら発生回数を足し、条件を満たしたら上の表に起票する。

| 知見 | 発生回数 | 出典 | 更新日 |
| --- | --- | --- | --- |
| L3の初回レビューを自分・reviewer・security-reviewerで並行させると、自分だけでは見落とすmustが出る（試行中） | 3本（#183・#184・#185） | `candidates/push-notifications.md`の事象1 | 2026-10-12 |
| 自分のPRに直しを足している間にユーザーがマージし、直しがmainに入らない | 2回（#196・#200） | `candidates/push-notifications.md`の事象3。Auto Memory`merge-race-own-prs` | 2026-10-12 |
| 並行で渡すタスクを触るファイルで分け、計画にタスクごとの主なファイルを書くと、3本を同時に動かしても衝突しない（成功手順） | 1回（#301・#302・#303） | `candidates/first-use-decisions.md`の事象1 | 2026-10-27 |
| 計画で指定した部品の置き場所が`boundaries/no-cross-feature`に当たる。2つ以上の`features/*`から使う部品は`shared/`に置く。2回目なら`create-implementation-plan`に1行足す | 1回（#302） | `candidates/first-use-decisions.md`の事象2 | 2026-10-27 |
| 名前を出す直しで、`displayNameOf`が「相手」を返す条件（一覧に無い・表示名が空）の一部だけを試験の観点に書いた | 1回（#302） | `candidates/first-use-decisions.md`の事象3 | 2026-10-27 |
| 結合検証環境で見る項目に、見るために要るデータを書かず、3か所を見られなかった | 1回（first-use-decisions） | `candidates/first-use-decisions.md`の事象4 | 2026-10-27 |
| 主な操作を消す案を推奨したが、ユーザーは小さく残す案を選んだ。消したときにほかの画面へ移る手間を、欠点に具体的に書く | 1回（精算の「支払いを記録」） | `candidates/first-use-decisions.md`の事象5 | 2026-10-27 |

