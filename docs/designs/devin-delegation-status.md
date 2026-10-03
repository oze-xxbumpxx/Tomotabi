# 設計書: devin-delegation-status

- ステータス: confirmed（2026-09-27ユーザー承認。未決事項1〜5はすべて推奨どおり）
- レベル: L2 / ユーザー承認: 必要（ハーネス`.claude/`のスクリプト・フック・スキル・settingsと、記録の形式・`.github/`のIssueテンプレートにまたがる）
- 関連: `docs/designs/devin-delegation-loop.md` / `docs/designs/devin-unlinked-pr-review.md` / `.claude/scripts/delegation.mjs` / `.claude/hooks/find-devin-prs.mjs` / `.claude/skills/review-devin-pr/SKILL.md` / `docs/claude-code/improvement-cycle.md`

## 背景

委譲ループ（Issue → Devin → PR → レビュー → 修正 → 再レビュー → 記録 → 集計 → 昇格）を、委譲の記録12件と09-25〜27のログで見直した（2026-09-27の分析）。
分類・自動投稿・上限といったループの中心は動いている。弱いのは端の3か所。

1. **セッションをまたぐと、進行中の委譲が見えなくなる。**
   - 待機スクリプトはセッションのバックグラウンド処理なので、セッションと一緒に止まる。
   - セッション開始時のフック（find-devin-prs）は、Issueに紐づかないPRしか見ない。委譲したIssueに紐づくPRは「wait-for-prが待っている」前提で除外している（`wait-for-devin-pr.mjs`の`findUnlinkedDevinPrs`）。レビュー前の記録 #70と`Closes #70`のPRを与えて確かめたところ、フックは何も出さなかった。
   - 修正待ちのPR、マージ済みでfinalizeしていない記録も見えない。いまは日次ログの「次回やること」に手で書くしかない。
   - 記録はセッションの作業ツリーにあり、close-sessionのPRがマージされるまでmainに入らない。ローカルでworktreeごとにセッションを開くと、別のセッションからは進行中の記録が見えない。
2. **学びを戻す最後の一歩に、きっかけがない。** `security`は09-26から昇格候補（2/2）だったが、起票したのは09-27（IMP-2026-001）。`summary`を呼ばない限り気づけず、close-sessionも「ログに書く」までだった。
3. **手戻りの主な経路が集計に出ない。**
   - Issue起点の10件のうち3件（#43・#48・#55）は前のPRの手直しで、#59も準備中。#37・#44・#51は後続を生んでいるのに、「一発合格」にもround（平均0.1〜0.3）にも表れない。自動投稿（2026-09-26の設計の承認後）→ 再レビューが動いたのは #54の1回だけで、実際の手戻りは後続のIssueに流れている。
   - 後続のIssueの本文は形が揃っている（目的 / 読む資料 / やること / テスト / やらないこと / 完了条件 / 進め方。#51・#59）が、テンプレートが無い。昇格した学びをIssueに入れる置き場も無い（`improvement-cycle.md`の変更先「Issueの書き方の不足 → `review-devin-pr`の委譲節」に、定型が無い）。

## 目的

1. どのセッションでも、始めた時点で「進行中の委譲と、次にやること」が分かる。待機の起動し直し・レビュー・finalizeを、記録から決める。
2. 昇格候補が出たら、起票されるまで毎回のセッション開始で見える。
3. 後続の委譲を記録で結び、手戻りを数えられるようにする。
4. 委譲のIssueに定型を置き、昇格した学びのうち特定の領域に限るものを、予防としてIssueに入れられるようにする。

## 要件

- R-1: 記録から次の動きを決める判定は純粋関数にし、`.claude/tests/`に`node --test`のテストを付ける。
- R-2: ghが無い・遅い環境（クラウドのセッションなど）でもセッションを止めない。記録だけで分かること（未起票の昇格候補）は出す。
- R-3: 同じマシンの別のセッション（別のworktree）で作った、mainに未マージの記録も見える。
- R-4: 公開リポジトリに入るもの（記録・Issueテンプレート・既知の指摘の表）に、securityの詳細を書かない（既存の方針どおり）。
- R-5: 既存の記録（12件）はそのまま読める。追加する項目は任意にする。
- R-6: Claudeのターンでポーリングしない（既存どおり）。

## 対象範囲

- `delegation.mjs status`（新規サブコマンド）と、その判定。
- セッション開始時のフック: `find-devin-prs.mjs`を`delegation-status.mjs`に置き換える（IssueなしPRの検出も含む）。
- 記録の写し: `init` / `review` / `finalize`が、ハーネスの状態ディレクトリにも同じ記録を書く。
- 記録の項目: reviewごとの`reviewed_at`、委譲の`follow_up_of`。
- `summary`: 後続の数と「後続なしの一発合格」。
- `wait-for-devin-pr.mjs`: `--exclude`をやめ、記録があるPRを既知として扱う。
- 委譲用のIssueテンプレート`.github/ISSUE_TEMPLATE/devin-task.md`と、「既知の指摘」の表。
- 手順の更新: `review-devin-pr`・`close-session`（3a）・`improvement-cycle.md`・`delegations/README.md`。
- 過去分: #43・#48・#55に`follow_up_of`を入れる。

## 対象外

- ローカルのDevinの起動をまとめるスクリプト（`devin-run.mjs`。分析の5）。別の設計にする。
- 昇格候補の雛形を作るコマンド（`promote`）。「未決事項」3。
- 昇格後の事後評価の自動化（昇格日からの委譲の数え上げ）。
- nitだけのときの投稿の方針（`devin-delegation-loop`の未決事項1）の変更。後続のデータが貯まってから見直す。
- sprint-reviewへの集計の組み込み。

## 現状構成

```
[セッション A]
gh issue create ─(hook)→ wait-for-pr.mjs <Issue>      [background] ─┐
devin -p …                                            [background]  │ A が終わると止まる
レビュー → 投稿 → wait-for-pr-update.mjs <PR>        [background] ─┘
delegation.mjs init / review → docs/…/delegations/<key>.yml
                               （A の作業ツリー。close の PR がマージされるまで main に無い）

[セッション B（後日・別の worktree）]
SessionStart: find-devin-prs → Issue なしの Devin PR だけを出す
  - A が委譲した Issue の PR・修正待ち・finalize 待ちは出ない
  - A の記録そのものが見えない
```

## 変更後構成

```
delegation.mjs init / review / finalize
  ├─→ docs/claude-code/improvements/delegations/<key>.yml     正（close-session でコミット）
  └─→ <状態ディレクトリ>/delegations/<key>.yml                 写し（同じマシンのどのセッションからも読める）

SessionStart: delegation-status.mjs（find-devin-prs を置き換え。判定は delegation.mjs status と同じ）
  ├─ 記録（正 ∪ 写し）の、完了していない委譲ごとに「次の動き」
  ├─ Issue なしの Devin PR（記録が無く、レビューの印も無いもの）
  └─ 未起票の昇格候補（summary の candidate で、candidates/delegation-<category>.md が無いもの）
```

### 次の動き（完了していない記録ごと）

完了 = `outcome`が`merged` / `closed`。それ以外の記録について、上から順に見て最初に当てはまった行を出す。

| 状態 | 判定 | 表示する次の動き |
| --- | --- | --- |
| PRが閉じた | PRがMERGED / CLOSED | `delegation.mjs finalize <key>` |
| PR待ち | Issueの記録で、紐づくPRが無い | `wait-for-pr.mjs <Issue>`を起動し直す。委譲からの経過時間も出す |
| 初回レビュー前 | PRがある・`reviews`が空 | `review-devin-pr`のround 0 |
| 再レビュー | PRがOPEN・headが最後の`reviewed_sha`と違う | round n+1（CIの完了はレビュー手順1で待つ） |
| 修正待ち | 最後のverdictが`fix`・headが同じ | `wait-for-pr-update.mjs <PR> --since <reviewed_at> --sha <sha>`を起動し直す。ローカルなら、Devinの修正セッションが動いているかを確かめる |
| ユーザー待ち | 最後のverdictが`escalate` / `merge`・headが同じ | 表示だけ（判断待ち / マージ待ち） |

- PRの特定は、記録の`pr`・`gh.pr`、無ければ`findLinkedPr`（wait-for-prと同じ規則）。
- 「PR待ち」が8時間（wait-for-prの既定の時間切れ）を超えたら、DevinがPRを作らずに終わった可能性も添える。

### 記録の写し（R-3）

- 置き場は`harness-paths.mjs`の状態ディレクトリ（`~/.local/state/tomotabi-harness/delegations/`）。worktreeが違っても同じ場所になる。
- 書くのは`writeRecord`の1か所。正を書いたあとに写しも書く。写しの失敗は警告だけで、正の書き込みは成功扱いにする。
- 読むときは、正と写しをkeyでまとめる。両方あれば`reviews`が多い方、同じなら`outcome`が決まっている方、それも同じなら正を使う。
- 完了した記録の写しは、`status`が完了から30日を過ぎたものを消す（写しが増え続けないように）。正がmainに入っているので、情報は失わない。
- close-sessionでコミットするのは、finalizeした記録（`outcome`がmerged / closed）だけにする。進行中の記録は写しで次のセッションに引き継ぐ。
  委譲したworktreeと、レビューした別のworktreeの両方が同じ記録をコミットすると、closeのPRどうしが衝突するため（実装時に追加）。
  写しが残らないクラウドのセッションでは、今までどおり進行中の記録もコミットする。

### 記録の項目の追加（R-5）

```yaml
follow_up_of: 51            # 任意。前の委譲の key（Issue 番号か 'pr-<n>'）。
                            # 複数の PR の指摘をまとめたときは、いちばん古い委譲を指す（#59 → 51）
reviews:
  - round: 0
    reviewed_at: '2026-09-27T01:23:45Z'   # 任意。review を記録した時刻（修正待ちの --since に使う）
    reviewed_sha: '…'
    …
```

- `init <Issue> --follow-up-of <key>`で入れる。`review`は`reviewed_at`を自動で入れる。
- 項目の無い記録は`follow_up_of: null`とみなし、`reviewed_at`の代わりに`delegated_at`を使う。

### summaryの追加

```
後続の委譲: 3/10（#43←#37 #48←#44 #55←#51）
モデル別: 件数 / マージ / 一発合格 / 後続なしの一発合格 / 後続を生んだ / 平均round / CI初回成功 / …
```

- 「後続を生んだ」= 他の記録の`follow_up_of`がこの記録を指している。
- 「後続なしの一発合格」= round 0が`merge`で、後続を生んでいない。

### Issueテンプレートと既知の指摘

`.github/ISSUE_TEMPLATE/devin-task.md`。いまのIssue（#51・#59）の節をそのまま定型にし、「元のPR」と「既知の指摘」を足す。

```markdown
## 目的
（何を・なぜ。変更レベルとユーザー承認の要否）

## 元の PR（後続のときだけ）
（どの PR のどの指摘か。記録の init に --follow-up-of <key> を付ける）

## 読む資料
## やること
## テスト

## 既知の指摘（関係する領域のときだけ）
（review-devin-pr の「既知の指摘」の表から、この Issue の領域の行を写す）

## やらないこと
## 完了条件

## 進め方
`.agents/skills/devin-workflow/SKILL.md` に従う。ブランチは `devin/<内容>-<Issue>`。PR 本文に `Closes #<Issue>` を書く。
```

- Claudeは`gh issue create --body-file`でIssueを書くので、テンプレートは本文の定型として`review-devin-pr`の「委譲」節から参照する（GitHubの画面から作るときにも出る）。
- 「既知の指摘」の表（領域 / 予防の1行 / 出典のIMP）は`review-devin-pr`の「委譲」節に置く。最初は空。
- 予防の置き場の決め方を`improvement-cycle.md`の「変更先」に足す。どの委譲にも効くもの → `devin-workflow`、特定の領域（例: HTTPのテスト、ログ）だけのもの → 「既知の指摘」の表。二重に書かない。IMP-2026-001（security）は前者として`devin-workflow`に入れた。

## データフロー

- `status`の入力:
  - 記録（正 ∪ 写し）
  - gh: `gh pr list --state all --search created:>=<完了していない記録のうち最古の delegated_at>`を1回、OPENのDevin PRの一覧を1回、Issueなしの候補のコメントを候補ごとに1回
  - `docs/claude-code/improvements/candidates/`のファイル名
- 出力: 委譲ごとに1行の「次の動き」、IssueなしPRの行、未起票の昇格候補の行。`--json`で同じ内容をJSONにする。

## API設計

対象外（アプリのAPIは変えない）。スクリプトのCLIは次のとおり。

| コマンド | 役割 | 終了コード |
| --- | --- | --- |
| `delegation.mjs status [--json] [--no-gh]` | 上の「次の動き」とIssueなしPR、未起票の昇格候補を出す。`--no-gh`は記録だけで分かること（昇格候補と記録上の最後の状態）に限る | 0（出す行が無くても0）/ 2 |
| `delegation.mjs init <Issue> … [--follow-up-of <key>]` | 任意の引数を追加 | 既存どおり |
| `delegation.mjs review …` | `reviewed_at`を自動で入れる | 既存どおり |
| `wait-for-devin-pr.mjs --since <ISO> [--interval 秒] [--timeout 秒]` | `--exclude`を削る。記録（正 ∪ 写し）があるPRは既知として通知しない | 既存どおり |

## DB設計

対象外。

## フロントエンド設計

対象外。

## バックエンド設計

対象外（アプリのコードは変えない）。変更するハーネスのファイルは次のとおり。

| ファイル | 変更 |
| --- | --- |
| `.claude/scripts/delegation.mjs` | 写し・`follow_up_of`・`reviewed_at`・summaryの列。`status`は下のモジュールを動的に読み込んで実行する |
| `.claude/scripts/delegation-status.mjs` | 新規。`status`の判定とghの呼び出し（`wait-for-devin-pr.mjs`を使うため、`delegation.mjs`と循環しないよう別のモジュールにする） |
| `.claude/scripts/wait-for-devin-pr.mjs` | `--exclude`を削除し、既知の判定を「記録がある」にする |
| `.claude/hooks/delegation-status.mjs` | 新規（find-devin-prsを置き換え） |
| `.claude/hooks/find-devin-prs.mjs`・`.claude/tests/find-devin-prs.test.mjs` | 削除（テストの観点はdelegation-statusへ移す） |
| `.claude/settings.json` | SessionStartのフックを差し替える |
| `.claude/tests/delegation.test.mjs`・`wait-for-devin-pr.test.mjs`・`delegation-status.test.mjs` | 追加・更新 |
| `.github/ISSUE_TEMPLATE/devin-task.md` | 新規 |
| `.claude/skills/review-devin-pr/SKILL.md` | 委譲節（テンプレート・`--follow-up-of`・既知の指摘の表）、IssueなしPRの手順1から`--exclude`を削る、セッション開始時の表示への言及 |
| `.claude/skills/close-session/SKILL.md` | 3aに「`status`でfinalize待ちが残っていないかを確かめる」と、finalizeした記録だけをコミットすること |
| `docs/claude-code/improvement-cycle.md` | 予防の置き場の決め方 |
| `docs/claude-code/improvements/delegations/README.md` | 追加の項目と写しの説明 |
| `docs/claude-code/improvements/delegations/43.yml`・`48.yml`・`55.yml` | `follow_up_of` |
| `AGENTS.md` | 変えない（Devinの入口の記述は変わらない） |

## エラー処理

外部I/Oはghと、状態ディレクトリへの書き込み。

- (a)リトライ: しない。SessionStartは1回きり。ghが失敗したら、記録だけで分かる行（未起票の昇格候補と、記録上の最後の状態）を出し、「ghで確かめられなかった」と1行添える。
- (b)タイムアウト: ghは1回8秒（find-devin-prsと同じ）。フック全体はsettingsの30秒。
- (c)冪等性: `status`は読むだけ（写しの掃除を除く）。写しの書き込みは正と同じ内容の上書きなので、何度実行してもよい。
- (d)部分失敗: 写しの書き込みに失敗しても正は戻さない（警告だけ）。読むときの優先順（reviewsの多い方 → outcomeのある方 → 正）により、古い写しが残っても新しい方が使われる。
- (e)フォールバック: ghが無いときは記録だけの表示にする。状態ディレクトリが使えない（`StateDirError`）ときは、写しなしで正だけを読む。

## ログと監視

- フックは、出す行が無ければ何も出さない（既存どおり）。
- `status`の出力はSessionStartの追加コンテキストになる。「ユーザーの今の依頼を優先し、区切りのよいところで対応する」を添える（find-devin-prsと同じ）。

## セキュリティ

- 写しは公開リポジトリではなく手元に置く（パーミッションはharness-pathsの既存の確認に従う）。中身は正と同じで、securityのsummaryは`(非公開)`のまま。
- Issueテンプレートと「既知の指摘」の表にsecurityの詳細を書かない。予防の一般的な書き方だけにする（IMP-2026-001と同じ）。
- 表示にPRのタイトルを出す（find-devin-prsと同じ）。タイトルは外部（Devin）の文字列なので、改行を落として1行にし、長さを切る。

## 性能

- ghの呼び出しは、`status` 1回につき`pr list` 2回と、Issueなしの候補ごとのコメント取得（ふつう0〜2件）。SessionStartの30秒に収まる。
- 記録の読み込みは数十ファイルで、問題にならない。

## テスト方針

`node --test`。ghは呼ばない（判定は純粋関数にし、ghの応答は固定のJSONで与える）。

- 次の動き: 表の6つの状態それぞれ、完了済みを出さないこと、PRの特定（`gh.pr` / `pr` / `findLinkedPr`）、`reviewed_at`が無い古い記録、「PR待ち」の8時間超の注記。
- 写し: 正だけ・写しだけ・両方（reviewsの多い方、outcomeのある方、同じなら正）、完了から30日を過ぎた写しの掃除、状態ディレクトリが使えないとき。
- IssueなしPR: find-devin-prsとwait-for-devin-prの既存のテストを移す。記録があるPRは既知になる（`--exclude`が要らない）。
- 昇格候補: candidateで`candidates/delegation-<category>.md`が無ければ出し、あれば出さない。
- summary: 後続を生んだ・後続なしの一発合格の数え方、`follow_up_of`が無い記録。
- フック: ghが失敗してもexit 0で、記録だけの行を出す。
- 手動の結合確認: 次のローカルの委譲で、委譲した直後にセッションを閉じ、別のworktreeで始めたセッションの開始時に「PR待ち」が出ることを確かめる。結果を日次ログに書く。

## 移行とリリース

1. この設計書の承認。
2. 実装計画・試験計画 → 実装（本ブランチ）→ `npm run test:harness`と品質ゲート → PR → ユーザーのマージ。
3. 過去分の`follow_up_of`（#43←#37、#48←#44、#55←#51）は、`readRecord` / `writeRecord`を使う短いスクリプトで入れる（YAMLを手で編集しない）。
4. 写しは、マージ後に最初に`init` / `review` / `finalize`した記録から作られる。既存の記録はmainにあるので、写しは要らない。
5. ロールバック: PRをrevertすればfind-devin-prsに戻る。写しのディレクトリは残っても害がない（消してよい）。

## リスク

| リスク | 対策 |
| --- | --- |
| セッション開始の表示が長くなり、今の依頼の邪魔になる | 1委譲1行。「ユーザーの今の依頼を優先する」を添える |
| 写しと正が食い違う | 読むときの優先順を固定し、テストで固める。正はclose-sessionでコミットされる |
| 写しの掃除で必要な記録を消す | 消すのは、完了済みで30日を過ぎたものだけ。正がmainにある |
| `follow_up_of`の付け忘れ | Issueテンプレートの「元のPR」節と、`review-devin-pr`の委譲節で促す。付け忘れても集計がずれるだけで、ループは止まらない |
| クラウドのセッション（gh無し）では結合確認ができない | ローカルの次の委譲で確かめる（「テスト方針」） |

## 未決事項

推奨を先に書く。

1. **別のセッションの記録を見る方法** — 推奨: 状態ディレクトリへの写し。別案: (b) `git worktree list`で他の作業ツリーの記録を読む（書き込みは増えないが、worktreeが消えると見えない）。(c)正だけ（同じ作業ツリーで続けるか、closeのPRがマージされるまで見えない）。
2. **find-devin-prsの扱い** — 推奨: `delegation-status.mjs`に置き換え、セッション開始の表示を1つにまとめる。別案: 残して別のフックを足す（表示が2つに分かれる）。
3. **昇格の起票の雛形を作るコマンド（`promote`）** — 推奨: 作らない（12件で1回。`status`で気づければ手で起票できる）。別案: 作る（ファイル名の付け間違いが無くなる）。
4. **summaryの`ci_first_pass`の列** — 推奨: 残す（CIにharnessのジョブを足したので、差が出るかを見る）。別案: 消す（今は10/10で差が出ない）。
5. **写しを掃除するまでの期間** — 推奨: 完了から30日。別案: 掃除しない（増えても年に数百ファイル程度）。
