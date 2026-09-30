---
name: review-devin-pr
description: >
  Devin など他のエージェントが Issue から作った PR を、Claude Code がレビューし、
  指摘 → Devin の修正 → 再レビューのループを上限付きで回す手順。`gh issue create` の後に
  wait-for-pr.mjs で PR を待ち、見つかって呼び戻されたとき、または wait-for-pr-update.mjs で
  呼び戻されたときに使う。「PR ができた」「Devin の PR をレビューして」と言われたときにも使う。
  Devin が Issue なしで自分から出した PR（知見・スキル・blueprint など）も、wait-for-devin-pr.mjs や
  セッション開始時のフック（delegation-status）で見つかったら同じ手順でレビューする。
  セッション開始時に進行中の委譲の「次の動き」が出たとき（待機の起動し直し・レビュー・finalize）にも使う。
  コードは直さない。must / nit の指摘は自動で PR に投稿し、security / decision はユーザーに渡す。
---

# 他エージェントの PR のレビューと修正ループ

設計: `docs/designs/devin-delegation-loop.md`（Issue なし PR は `docs/designs/devin-unlinked-pr-review.md`、セッションをまたぐ状態は `docs/designs/devin-delegation-status.md`）。記録の形式: `docs/claude-code/improvements/delegations/README.md`。

## セッションをまたぐとき

待機スクリプトは、このセッションの `run_in_background` なので、セッションが終わると一緒に止まる。
次のセッションの開始時に、フック（delegation-status）が委譲の記録（リポジトリの正 ∪ 状態ディレクトリの写し）と gh から、
進行中の委譲ごとの次の動き（PR 待ち・初回レビュー前・再レビュー・修正待ち・ユーザー待ち・finalize）と、
記録の無い Issue なし PR、未起票の昇格候補を出す。いつでも `node .claude/scripts/delegation.mjs status` で同じものを見られる。
ユーザーの今の依頼を優先し、区切りのよいところで、その行のとおりに待機を起動し直す・レビューする・finalize する。
記録は写しにも書かれるので、別の worktree のセッションで作った記録も、そのまま `review` / `finalize` できる。

## 委譲（Issue を渡した直後）

0. Issue の本文は `.github/ISSUE_TEMPLATE/devin-task.md` の節の順に書く。前の PR の指摘を直す後続の Issue なら「元の PR」を、
   関係する領域の行が下の「既知の指摘」の表にあれば「既知の指摘」を書く。

   **既知の指摘**（昇格した学びのうち、特定の領域に限る予防。どの委譲にも効く予防は `devin-workflow` に置き、ここには書かない。
   置き場の決め方は `improvement-cycle.md` の「委譲ループの軽量サイクル」）:

   | 領域 | 予防の 1 行（Issue の「既知の指摘」に写す） | 出典 |
   | --- | --- | --- |
   | （まだ無い） | | |

1. `gh issue create` の後、フック（suggest-pr-watch）が促したら、まず記録を作る:
   `node .claude/scripts/delegation.mjs init <Issue> --model <swe-2-medium|swe-2-high|swe-2-max> [--runner cloud] [--level 0-3] [--follow-up-of <前の委譲>]`。
   `--follow-up-of` は後続の Issue のとき、前の委譲（Issue 番号か `pr-<n>`。複数ならいちばん古いもの）を指す。
   自分で実装する Issue では記録も待機もしない。
2. Devin を起動する（2026-09-26 ユーザー指示）。モデルは必ず SWE-2。effort は実装の難しさ・複雑さで選び、依頼時にユーザーへ伝える
   （目安: L0 / L1 → medium、通常の機能 → high、L3 で認証・お金・並行処理 → max）。
   - **既定はローカル**。専用クローン `/Users/siro/個人開発/devin-work/tomotabi`（Devin で信頼済み）で動かす。
     worktree は使わない（`.git` が元のリポジトリ側にあり、Devin の書き込み先が散らばる）。起動の前に次を確かめる:
     前の `devin` プロセスが終わっている（`pgrep -fl "devin .*-p"`。同じクローンで 2 つ同時に動かさない。
     前の PR がマージ・クローズ済みなのに残っているのは §4.5 の監視の間隔（5 分）の途中なので、
     自分が起動したバックグラウンドのタスクなら TaskStop で止めてよい。それ以外は止めずにユーザーに伝える）、
     作業ツリーがきれい（`git status --short` が空。残っていたら捨てずにユーザーに伝える）、
     `git fetch origin && git switch --detach origin/main` で最新の main から始める。
     起動（`run_in_background` で。以下「ログ付きの起動」）:
     `LOG=$(node .claude/scripts/devin-watch.mjs --log-path <Issue>) && cd <クローン> && set -o pipefail && devin --model swe-2-<effort> --permission-mode dangerous -p "<依頼>" 2>&1 | tee -a "$LOG"`。
     `--log-path` はログの置き場（0700）とファイル（0600）を作ってパスを返す。`pipefail` が無いと、終了コードが `tee` のものになり、
     Devin の異常終了が成功に見える。直しを頼む 2 回目以降のセッションも、同じ Issue 番号のログに追記する。
     起動したら、ユーザーが実装状況を見られるよう、ターミナル（`run_in_terminal`）に見張り画面を開く:
     `~/.local/state/tomotabi-harness/bin/devin-watch <Issue>`（タブ名 `Devin #<Issue> watch`）。
     `-p` の出力は発言だけなので、見張り画面は Devin が実行中のコマンド・変更中のファイル・PR と CI を合わせて出す。
     リンクが無ければ `node .claude/scripts/devin-watch.mjs --install` で作る（ターミナルには ASCII のコマンドしか渡せないため）。
     `--sandbox` は付けない（autonomous モードになり、確認が要る操作が拒否されて途中で止まる。#48）。
     dangerous は確認なしでコマンドを実行するため、Devin に危険操作の確認は効かない（ユーザー了承済みの割り切り）。代わりに:
     プロンプトに「作業はこのリポジトリのフォルダの中だけで行う。force push・ブランチの削除・履歴の書き換え・main への push・
     クローン外への書き込みはしない。必要になったら止まって報告する。PR を出したらセッションを終了せず、
     devin-workflow §4.5 に従ってコメントを監視して対応する」を必ず入れる。
     終了後に、`git -C <クローン> reflog -n 20` と `gh pr view <n> --json commits` で、force push や想定外のブランチ操作が無いかを確かめる。
   - **クラウドはユーザーが指示したときだけ**（出先のとき）。`devin --cloud -p "<依頼>"`。`--cloud` では `--model` が無視され、
     Devin Web の「セッションエージェント」の既定（SWE-2 High）で動く。High 以外が要るときは、依頼の前にユーザーに既定の切り替えを頼む。
     起動はローカルと同じ「ログ付きの起動」にする（`LOG=$(node .claude/scripts/devin-watch.mjs --log-path <Issue>) && set -o pipefail && devin --cloud -p "<依頼>" 2>&1 | tee -a "$LOG"`）。
     `| tail` に通すと、コマンドが終わるまで Devin の発言が見えず、止まっていても気づけない（#91・#92 は約 8 時間、ブランチも作らずに止まっていた）。
     起動の数分後にログに最初の発言が出ていることを確かめる。1 時間たってもブランチが無ければ、止めて起動し直し、ユーザーに伝える。
3. Bash の `run_in_background` で `node .claude/scripts/wait-for-pr.mjs <Issue>` を起動する。Issue ごとに 1 本。
   このセッションでまだ起動していなければ、`node .claude/scripts/wait-for-devin-pr.mjs --since <今の UTC 時刻>` も
   `run_in_background` で起動する（セッションで 1 本。下の「Issue なし PR」）。
4. 待機中は `sleep` や `gh` の繰り返しで様子を見ない。終了すると呼び戻される。
   - 終了コード 0: 出力の `{"issue":…}` の JSON 行に PR 番号がある（最後の行とは限らない）→「レビュー」の round 0 へ
   - 終了コード 3: 時間切れ → ユーザーに伝え、再度待つかを聞く

## レビュー（round 0 は全体、round 1 以降は前回のレビュー以降の差分）

1. **状態**: `gh pr view <n> --json files,statusCheckRollup,mergeable,body,headRefOid`。CI が未完了なら、
   `gh pr checks <n> --watch` を `run_in_background` で待つ（ポーリングしない）。
   round 1 以降は `gh api repos/{owner}/{repo}/compare/<前回の sha>...<今の head>` で差分を見て、
   前回の指摘が直ったかと、新しい変更に問題が無いかを見る。Devin の返信コメントも読む。
2. **範囲**: 変更ファイルが Issue の「やること」と範囲内か。範囲外のファイル、並行作業中の他 PR が作る
   はずの型・ファイルを先回りで作っていないか。本文に `Closes #<Issue>` があるか。
3. **中身**: 設計書・試験計画と突き合わせる。名前・置き場所・型・エラーコード・応答の形。
   Issue に書いた申し送り（前の PR からの持ち越し）が守られているか。
4. **テスト**: 試験計画の観点 ID がすべてあるか。テストが本当に本番と同じ組み立てで、その経路を通っているか
   （例: #35 は素の HTTP サーバーで試し Nest の例外経路を通っていなかった。#39 はテストと本番で `bodyParser` の設定が違った）。
5. **セキュリティ**（認証・ログ・外部入力を触る PR）: 迂回できないか、秘密がログや応答に出ないか、
   テスト用の仕組みが本番に混ざらないか。疑わしければ一時的な worktree で**実際に動かして再現**する。
   再現用のテストはコミットしない。worktree は `git worktree remove` で片付ける。
   Testcontainers がイメージ取得で止まるときは、空の `config.json` を置いた `DOCKER_CONFIG` を指定し、
   サンドボックス外で実行する（Docker の認証ヘルパーを避けるため）。
6. **衝突**: 並行 PR が同じファイルを触っていないか。マージ順を提案する。
   Devin の PR に `logs/` の変更があれば、`scope-creep` の `must` にする（`devin-workflow` §5。並行 PR の衝突の元）。

## Issue なし PR（Devin が自分から出した PR）

クラウドの Devin は、作業の終わりに学んだことをスキルや blueprint に残す PR を自分から出すことがある（#53・#54）。
対象は、`devin/` で始まるブランチの PR のうち、委譲の記録がある Issue に紐づかないもの。

1. **見つける**: `wait-for-devin-pr.mjs` が終了コード 0 で呼び戻したとき（出力の JSON 行に `pr`）、
   またはセッション開始時のフック（delegation-status）が一覧を出したとき。終了コード 3（時間切れ）は何もしない。
   待機は見つけると終わるので、見つかった PR の記録を下の 2 で作ってから、**同じ `--since`** で `run_in_background` で起動し直す
   （同じセッションで後から出る PR を拾うため。記録がある PR は通知しない）。
2. **記録**: `pr-<n>.yml` が無ければ `node .claude/scripts/delegation.mjs init pr-<n>`（題・作成日時・作成者を gh から取る。
   作成者が bot ならクラウド）。分かれば `--model swe-2-high`（クラウドの既定）と `--level` を付ける。
   既にあって `reviews` が空なら、前のセッションが中断したレビューなので init せずにその記録で続ける
   （セッション開始時の表示では「初回レビュー前」として出る）。
   以降の `review` / `finalize` も `pr-<n>` で指定する。
3. **レビュー**: 上の「レビュー」の 1・5・6 はそのまま。2〜4 は Issue の代わりに次で見る。

   | 観点 | 見ること |
   | --- | --- |
   | 説明 | 何を・なぜ、どのタスク（Issue / PR）から得た知見か |
   | 範囲 | 説明と変更ファイルが合っているか。目的外の行を変えていないか（#54 は説明コメントを英語の定型文に置き換えていた）。アプリのコードが混ざっていないか |
   | ハーネス（`.claude/`・`.agents/`・`.devin/`・`AGENTS.md`・`CLAUDE.md`） | **重点レビュー**。既存の規則・スキルと食い違わないか、重複していないか。blueprint の knowledge は環境のコマンド参照だけ（`docs/devin-setup.md`）で、規約や手順を書いていないか |
   | 事実 | 書かれたコマンド・環境変数・ポート・ファイルが実在し、正しいか |
   | 秘密 | 秘密・環境変数の値・ローカルのパスが入っていないか（入っていたら `security`） |
   | 他リポジトリ | Cookpit 専用のスキルや存在しない成果物を前提にしていないか |

4. **分類**: 既存の規則そのものを変える・食い違う内容は `decision`。事実の誤り（`knowledge-inaccurate`）・
   重複や置き場所の誤り（`harness-conflict`）・目的外の変更（`scope-creep`）は `must`。`Closes #N` が無いことは指摘しない。
5. 以降の「判定と次の動き」「自動投稿」「完了」は同じ（記録の指定は `pr-<n>`）。

## 指摘の分類

指摘ごとに severity と category（kebab-case。語彙は delegations/README.md。合うものがあれば新しく作らない）を付ける。

| severity | 意味 | 扱い |
| --- | --- | --- |
| `must` | 直さないとマージできない（設計書・試験計画との食い違い、テストが経路を通っていない、規約違反、`Closes` 漏れ） | 自動投稿 |
| `nit` | 直した方がよいがマージを止めない | `must` があれば同じコメントに入れる。`nit` だけなら投稿せず、後続 Issue の案としてユーザーに渡す |
| `security` | 迂回・秘密の漏れ・権限の不備など、公開すると悪用の手がかりになる | **投稿しない**。ユーザーに渡す |
| `decision` | 設計・範囲の判断が要る | 投稿しない。ユーザーに判断を仰ぐ |

- 認証・ログ・外部入力に関わる指摘は、まず `security` に当たるかを確かめる。**迷ったら `security`**。

## 判定と次の動き

上から順に見て、**最初に当てはまった行**に従う（上限と再指摘の判定を、投稿より先にする）。
自動投稿は round 0 と round 1 の 2 回だけ。round 2 は投稿しない。

| 状況 | verdict | 動き |
| --- | --- | --- |
| `security` がある | `escalate` | 投稿しない。「セキュリティ指摘」の手順でユーザーに渡す。他の指摘の投稿も止める |
| `decision` がある | `escalate` | 投稿しない。選択肢と推奨を付けてユーザーに渡す |
| 前回投稿した `must` が直っていない | `escalate` | 投稿しない。モデルを上げる／Claude が直す／Issue を分ける、の案を付けてユーザーに渡す |
| `must` がある・round 2 以降 | `escalate` | 同上（自動投稿の上限 2 回に達した） |
| `must` がある・round 0 か 1 | `fix` | 下の「自動投稿」→ 更新を待つ |
| `must` なし | `merge` | 「マージ可」をユーザーに伝える（`nit` は後続 Issue の案として添える）。PushNotification を送ってよい |

どの場合も、記録に追記する:
`node .claude/scripts/delegation.mjs review <Issue> --round <n> --sha <レビューした head> --verdict <merge|fix|escalate> [--posted] --finding '<severity>:<category>:<summary>' …`。
`security` の summary は自動で `(非公開)` になる。再現手順を記録やログに書かない（公開リポジトリのため）。

## 自動投稿（`must` / `nit`）

この設計の承認（2026-09-26）により、`must` と同じ回の `nit` は、ユーザーの了承を都度取らずに投稿してよい。

1. 1 回のレビューで 1 コメント。先頭に `<!-- claude-review round=<n> -->` を入れる。指摘ごとに「何が起きるか → 期待 → 直し方の案」（#35 の形）。
2. 本文に `(aside)` を入れない（Devin が対応しなくなる）。秘密・環境変数の値・ローカルのパスを書かない。
3. 範囲外の気づきは投稿しない（ユーザーに渡す）。
4. `gh pr comment <n> --body-file <file>` で投稿し、投稿時刻（`date -u +%Y-%m-%dT%H:%M:%SZ`）を控える。
5. **ローカルの委譲でも、通常は起動し直さない**。Devin は `devin-workflow` §4.5 で PR のコメントを監視しているので、
   投稿すれば自分で気づいて直す。投稿しても反応が無いとき（セッションが終了・クラッシュした場合）は、
   上の「委譲」2 と同じ確認をしてから、新しいローカルセッションを「ログ付きの起動」（同じ Issue 番号のログ）で起動して直させる
   （`devin -c` の再開は「failed to start ACP agent session」で動かなかった）。依頼は
   `"PR #<n>（ブランチ <branch>）を直す。gh pr view <n> --comments で claude-review round=<r> のコメントを読み、must を直して同じブランチに push する。force push はしない。"`。
   クラウドの委譲なら、Devin が PR のコメントに自動で対応するので起動しない。
6. `run_in_background` で `node .claude/scripts/wait-for-pr-update.mjs <PR> --since <投稿時刻> --sha <レビューした head>` を起動する。
   - 終了コード 0: 更新あり。`ciConclusion` が `failure` なら、Devin が CI を直している途中のことがあるので、
     `--sha <その head>` でもう一度待つ（1 回まで。続けて失敗したらユーザーに伝える）。`success` / `none` なら次の round のレビューへ
   - 終了コード 3: 時間切れ（既定 4 時間）→ ユーザーに伝える。Devin の反応（返信・コミット）が無いときは、監視が止まっている可能性も伝える
   - 終了コード 4: PR が閉じた / マージされた → 「完了」へ

## セキュリティ指摘

PR・Issue・コメント・記録のどこにも詳細を書かない。`security` の指摘があることも書かない。ユーザーに渡し、経路を決めてもらう。推奨の順:

1. 未マージ（main に入っていない）なら、Devin の新しいセッションを CLI で起動し、PR には書かずに直させる。
   ローカルのセッション（上の「委譲」2 の「ログ付きの起動」）が既定。PR に書かないので、指摘の中身はプロンプトだけで渡す
   （依頼は `"<ブランチ名> に push して直す。…"`）。ログは 0600 で、ほかの利用者からは読めない。
2. Devin の監視が止まっているか直せないときは、Devin の作業が終わっているのを確かめてから、Claude が同じブランチに commit する。
3. main に入っている問題なら、GitHub の Security Advisory（非公開）で扱う。

修正が push されたら、`wait-for-pr-update.mjs` で待って再レビューする（round を 1 つ進める）。

## 完了（マージ・クローズの後）

1. `node .claude/scripts/delegation.mjs finalize <Issue>`（PR が見つからなければ `--pr <n>`。Issue なし PR は `finalize pr-<n>`）。
2. 記録は Devin のブランチに commit しない。その日の締め（close-session）の PR に、finalize した記録（`outcome` が merged / closed）だけを入れる。
   進行中の記録は写しで次のセッションに引き継ぐので、コミットしない（別の worktree のセッションと同じ記録を二重にコミットして、
   close の PR どうしが衝突するのを避けるため）。写しが残らないクラウドのセッションでは、今までどおり進行中の記録もコミットする。
3. `node .claude/scripts/delegation.mjs summary` で昇格候補が出たら、`improvement-cycle.md` の
   「委譲ループの軽量サイクル」に従って候補を起票する。

## 報告

- PR ごとに「マージ可 / 手直し中（round n）/ ユーザーの判断が必要」を先に書き、根拠・再現結果・後続への申し送りを続ける。
- マージはユーザーが行う。Claude Code はマージしない。
- 衝突の解消を頼まれたら、worktree で main を取り込み、両方の記述を残して解消し、lint・型・テストを通してから push する。
  修正中のエージェントがいるブランチには、同時にコミットしない。
