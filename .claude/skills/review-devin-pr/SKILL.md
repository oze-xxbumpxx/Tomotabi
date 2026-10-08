---
name: review-devin-pr
description: >
  Devinなど他のエージェントがIssueから作ったPRを、Claude Codeがレビューし、
  指摘 → Devinの修正 → 再レビューのループを上限付きで回す手順。`gh issue create`の後に
  wait-for-pr.mjsでPRを待ち、見つかって呼び戻されたとき、またはwait-for-pr-update.mjsで
  呼び戻されたときに使う。「PRができた」「DevinのPRをレビューして」と言われたときにも使う。
  DevinがIssueなしで自分から出したPR（知見・スキル・blueprintなど）も、wait-for-devin-pr.mjsや
  セッション開始時のフック（delegation-status）で見つかったら同じ手順でレビューする。
  セッション開始時に進行中の委譲の「次の動き」が出たとき（待機の起動し直し・レビュー・finalize）にも使う。
  コードは直さない。must / nitの指摘は自動でPRに投稿し、security / decisionはユーザーに渡す。
---

# 他エージェントのPRのレビューと修正ループ

設計: `docs/designs/devin-delegation-loop.md`（IssueなしPRは`docs/designs/devin-unlinked-pr-review.md`、セッションをまたぐ状態は`docs/designs/devin-delegation-status.md`）。記録の形式: `docs/claude-code/improvements/delegations/README.md`。

## セッションをまたぐとき

待機スクリプトは、このセッションの`run_in_background`なので、セッションが終わると一緒に止まる。
次のセッションの開始時に、フック（delegation-status）が委譲の記録（リポジトリの正 ∪ 状態ディレクトリの写し）とghから、
進行中の委譲ごとの次の動き（PR待ち・初回レビュー前・再レビュー・修正待ち・ユーザー待ち・finalize）と、
記録の無いIssueなしPR、未起票の昇格候補を出す。いつでも`node .claude/scripts/delegation.mjs status`で同じものを見られる。
ユーザーの今の依頼を優先し、区切りのよいところで、その行のとおりに待機を起動し直す・レビューする・finalizeする。
記録は写しにも書かれるので、別のworktreeのセッションで作った記録も、そのまま`review` / `finalize`できる。

## 委譲（Issueを渡した直後）

0. Issueの本文は`.github/ISSUE_TEMPLATE/devin-task.md`の節の順に書く。前のPRの指摘を直す後続のIssueなら「元のPR」を、
   関係する領域の行が下の「既知の指摘」の表にあれば「既知の指摘」を書く。

   **既知の指摘**（昇格した学びのうち、特定の領域に限る予防。どの委譲にも効く予防は`devin-workflow`に置き、ここには書かない。
   置き場の決め方は`improvement-cycle.md`の「委譲ループの軽量サイクル」）:

   | 領域 | 予防の1行（Issueの「既知の指摘」に写す） | 出典 |
   | --- | --- | --- |
   | E2E | 日付は今日から数えて作り、年や日を決め打ちしない。要素は役割・見出し・ラベルで探し、クラス名で探さない。APIを模擬したら、外す条件をPRの説明に書く | #100・#128・#152・#158 |

1. `gh issue create`の後、フック（suggest-pr-watch）が促したら、まず記録を作る:
   `node .claude/scripts/delegation.mjs init <Issue> --model <swe-2-medium|swe-2-high|swe-2-max> [--runner cloud] [--level 0-3] [--follow-up-of <前の委譲>]`。
   `--follow-up-of`は後続のIssueのとき、前の委譲（Issue番号か`pr-<n>`。複数ならいちばん古いもの）を指す。
   自分で実装するIssueでは記録も待機もしない。
2. Devinを起動する（2026-09-26ユーザー指示）。モデルは必ずSWE-2。effortは実装の難しさ・複雑さで選び、依頼時にユーザーへ伝える
   （目安: L0 / L1 → medium、通常の機能 → high、L3で認証・お金・並行処理 → max）。
   - **既定はローカル**。専用クローン`/Users/siro/個人開発/devin-work/tomotabi`（Devinで信頼済み）で動かす。
     worktreeは使わない（`.git`が元のリポジトリ側にあり、Devinの書き込み先が散らばる）。起動の前に次を確かめる:
     前の`devin`プロセスが終わっている（`pgrep -fl "devin .*-p"`。同じクローンで2つ同時に動かさない。
     前のPRがマージ・クローズ済みなのに残っているのは §4.5の監視の間隔（5分）の途中なので、
     自分が起動したバックグラウンドのタスクならTaskStopで止めてよい。それ以外は止めずにユーザーに伝える）、
     作業ツリーがきれい（`git status --short`が空。残っていたら捨てずにユーザーに伝える）、
     `git fetch origin && git switch --detach origin/main`で最新のmainから始める。
     起動（`run_in_background`で。以下「ログ付きの起動」）:
     `LOG=$(node .claude/scripts/devin-watch.mjs --log-path <Issue>) && cd <クローン> && set -o pipefail && devin --model swe-2-<effort> --permission-mode dangerous -p "<依頼>" 2>&1 | tee -a "$LOG"`。
     `--log-path`はログの置き場（0700）とファイル（0600）を作ってパスを返す。`pipefail`が無いと、終了コードが`tee`のものになり、
     Devinの異常終了が成功に見える。直しを頼む2回目以降のセッションも、同じIssue番号のログに追記する。
     起動したら、ユーザーが実装状況を見られるよう、ターミナル（`run_in_terminal`）に見張り画面を開く:
     `~/.local/state/tomotabi-harness/bin/devin-watch <Issue>`（タブ名`Devin #<Issue> watch`）。
     `-p`の出力は発言だけなので、見張り画面はDevinが実行中のコマンド・変更中のファイル・PRとCIを合わせて出す。
     リンクが無ければ`node .claude/scripts/devin-watch.mjs --install`で作る（ターミナルにはASCIIのコマンドしか渡せないため）。
     `--sandbox`は付けない（autonomousモードになり、確認が要る操作が拒否されて途中で止まる。#48）。
     dangerousは確認なしでコマンドを実行するため、Devinに危険操作の確認は効かない（ユーザー了承済みの割り切り）。代わりに:
     プロンプトに「作業はこのリポジトリのフォルダの中だけで行う。force push・ブランチの削除・履歴の書き換え・mainへのpush・
     クローン外への書き込みはしない。必要になったら止まって報告する。PRを出したらセッションを終了せず、
     devin-workflow §4.5に従ってコメントを監視して対応する」を必ず入れる。
     終了後に、`git -C <クローン> reflog -n 20`と`gh pr view <n> --json commits`で、force pushや想定外のブランチ操作が無いかを確かめる。
   - **クラウドはユーザーが指示したときだけ**（出先のとき）。`devin --cloud -p "<依頼>"`。`--cloud`では`--model`が無視され、
     Devin Webの「セッションエージェント」の既定（SWE-2 High）で動く。High以外が要るときは、依頼の前にユーザーに既定の切り替えを頼む。
     起動はローカルと同じ「ログ付きの起動」にする（`LOG=$(node .claude/scripts/devin-watch.mjs --log-path <Issue>) && set -o pipefail && devin --cloud -p "<依頼>" 2>&1 | tee -a "$LOG"`）。
     `| tail`に通すと、コマンドが終わるまでDevinの発言が見えず、止まっていても気づけない（#91・#92は約8時間、ブランチも作らずに止まっていた）。
   - **止まっていないかの見張り（ローカル・クラウドとも）**: 起動の直前にログのバイト数を控え（`OFFSET=$(stat -f%z "$LOG" 2>/dev/null || echo 0)`）、
     起動の直後に`run_in_background`で`node .claude/scripts/devin-stall-watch.mjs <Issue> --log "$LOG" --offset "$OFFSET"`を起動する。
     ログは同じIssueのファイルに追記されるので、控えたバイト数より増えたかで今回のセッションの発言を見分ける。
     終了コード0（ブランチができた）は何もしない。5（5分たっても今回の発言が無い）・6（1時間たってもブランチが無い）なら、
     Devinを止めて同じ手順で起動し直し、ユーザーに短く伝える。2回続けて止まったらユーザーに渡す。
3. Bashの`run_in_background`で`node .claude/scripts/wait-for-pr.mjs <Issue>`を起動する。Issueごとに1本。
   このセッションでまだ起動していなければ、`node .claude/scripts/wait-for-devin-pr.mjs --since <今の UTC 時刻>`も
   `run_in_background`で起動する（セッションで1本。下の「IssueなしPR」）。
4. 待機中は`sleep`や`gh`の繰り返しで様子を見ない。終了すると呼び戻される。
   - 終了コード0: 出力の`{"issue":…}`のJSON行にPR番号がある（最後の行とは限らない）→「レビュー」のround 0へ
   - 終了コード3: 時間切れ → ユーザーに伝え、再度待つかを聞く

## レビュー（round 0は全体、round 1以降は前回のレビュー以降の差分）

1. **状態**: `gh pr view <n> --json files,statusCheckRollup,mergeable,body,headRefOid`。CIが未完了なら、
   `gh pr checks <n> --watch`を`run_in_background`で待つ（ポーリングしない）。
   round 1以降は`gh api repos/{owner}/{repo}/compare/<前回の sha>...<今の head>`で差分を見て、
   前回の指摘が直ったかと、新しい変更に問題が無いかを見る。Devinの返信コメントも読む。
2. **範囲**: 変更ファイルがIssueの「やること」と範囲内か。範囲外のファイル、並行作業中の他PRが作る
   はずの型・ファイルを先回りで作っていないか。本文に`Closes #<Issue>`があるか。
3. **中身**: 設計書・試験計画と突き合わせる。名前・置き場所・型・エラーコード・応答の形。
   Issueに書いた申し送り（前のPRからの持ち越し）が守られているか。
4. **テスト**: 試験計画の観点IDがすべてあるか。テストが本当に本番と同じ組み立てで、その経路を通っているか
   （例: #35は素のHTTPサーバーで試しNestの例外経路を通っていなかった。#39はテストと本番で`bodyParser`の設定が違った）。
5. **セキュリティ**（認証・ログ・外部入力を触るPR）: 迂回できないか、秘密がログや応答に出ないか、
   テスト用の仕組みが本番に混ざらないか。疑わしければ一時的なworktreeで**実際に動かして再現**する。
   再現用のテストはコミットしない。worktreeは`git worktree remove`で片付ける。
   Testcontainersがイメージ取得で止まるときは、空の`config.json`を置いた`DOCKER_CONFIG`を指定し、
   サンドボックス外で実行する（Dockerの認証ヘルパーを避けるため）。
6. **衝突**: 並行PRが同じファイルを触っていないか。マージ順を提案する。
   DevinのPRに`logs/`の変更があれば、`scope-creep`の`must`にする（`devin-workflow` §5。並行PRの衝突の元）。

## IssueなしPR（Devinが自分から出したPR）

クラウドのDevinは、作業の終わりに学んだことをスキルやblueprintに残すPRを自分から出すことがある（#53・#54）。
対象は、`devin/`で始まるブランチのPRのうち、委譲の記録があるIssueに紐づかないもの。

1. **見つける**: `wait-for-devin-pr.mjs`が終了コード0で呼び戻したとき（出力のJSON行に`pr`）、
   またはセッション開始時のフック（delegation-status）が一覧を出したとき。終了コード3（時間切れ）は何もしない。
   待機は見つけると終わるので、見つかったPRの記録を下の2で作ってから、**同じ`--since`** で`run_in_background`で起動し直す
   （同じセッションで後から出るPRを拾うため。記録があるPRは通知しない）。
2. **記録**: `pr-<n>.yml`が無ければ`node .claude/scripts/delegation.mjs init pr-<n>`（題・作成日時・作成者をghから取る。
   作成者がbotならクラウド）。分かれば`--model swe-2-high`（クラウドの既定）と`--level`を付ける。
   既にあって`reviews`が空なら、前のセッションが中断したレビューなのでinitせずにその記録で続ける
   （セッション開始時の表示では「初回レビュー前」として出る）。
   以降の`review` / `finalize`も`pr-<n>`で指定する。
3. **レビュー**: 上の「レビュー」の1・5・6はそのまま。2〜4はIssueの代わりに次で見る。

   | 観点 | 見ること |
   | --- | --- |
   | 説明 | 何を・なぜ、どのタスク（Issue / PR）から得た知見か |
   | 範囲 | 説明と変更ファイルが合っているか。目的外の行を変えていないか（#54は説明コメントを英語の定型文に置き換えていた）。アプリのコードが混ざっていないか |
   | ハーネス（`.claude/`・`.agents/`・`.devin/`・`AGENTS.md`・`CLAUDE.md`） | **重点レビュー**。既存の規則・スキルと食い違わないか、重複していないか。blueprintのknowledgeは環境のコマンド参照だけ（`docs/devin-setup.md`）で、規約や手順を書いていないか |
   | 事実 | 書かれたコマンド・環境変数・ポート・ファイルが実在し、正しいか |
   | 秘密 | 秘密・環境変数の値・ローカルのパスが入っていないか（入っていたら`security`） |
   | 他リポジトリ | Cookpit専用のスキルや存在しない成果物を前提にしていないか |

4. **分類**: 既存の規則そのものを変える・食い違う内容は`decision`。事実の誤り（`knowledge-inaccurate`）・
   重複や置き場所の誤り（`harness-conflict`）・目的外の変更（`scope-creep`）は`must`。`Closes #N`が無いことは指摘しない。
5. 以降の「判定と次の動き」「自動投稿」「完了」は同じ（記録の指定は`pr-<n>`）。

## 指摘の分類

指摘ごとにseverityとcategory（kebab-case。語彙はdelegations/README.md。合うものがあれば新しく作らない）を付ける。

| severity | 意味 | 扱い |
| --- | --- | --- |
| `must` | 直さないとマージできない（設計書・試験計画との食い違い、テストが経路を通っていない、規約違反、`Closes`漏れ） | 自動投稿 |
| `nit` | 直した方がよいがマージを止めない | `must`があれば同じコメントに入れる。`nit`だけなら投稿せず、後続Issueの案としてユーザーに渡す |
| `security` | 迂回・秘密の漏れ・権限の不備など、公開すると悪用の手がかりになる | **投稿しない**。ユーザーに渡す |
| `decision` | 設計・範囲の判断が要る | 投稿しない。ユーザーに判断を仰ぐ |

- 認証・ログ・外部入力に関わる指摘は、まず`security`に当たるかを確かめる。**迷ったら`security`**。

## 判定と次の動き

上から順に見て、**最初に当てはまった行**に従う（上限と再指摘の判定を、投稿より先にする）。
自動投稿はround 0とround 1の2回だけ。round 2は投稿しない。

| 状況 | verdict | 動き |
| --- | --- | --- |
| `security`がある | `escalate` | 投稿しない。「セキュリティ指摘」の手順でユーザーに渡す。他の指摘の投稿も止める |
| `decision`がある | `escalate` | 投稿しない。選択肢と推奨を付けてユーザーに渡す |
| 前回投稿した`must`が直っていない | `escalate` | 投稿しない。モデルを上げる／Claudeが直す／Issueを分ける、の案を付けてユーザーに渡す |
| `must`がある・round 2以降 | `escalate` | 同上（自動投稿の上限2回に達した） |
| `must`がある・round 0か1 | `fix` | 下の「自動投稿」→ 更新を待つ |
| `must`なし | `merge` | 下の「レビュー完了のコメント」をPRに付け、「マージ可」をユーザーに伝える（`nit`は後続Issueの案として添える）。PushNotificationを送ってよい |

どの場合も、記録に追記する:
`node .claude/scripts/delegation.mjs review <Issue> --round <n> --sha <レビューした head> --verdict <merge|fix|escalate> [--posted] --finding '<severity>:<category>:<summary>' …`。
`security`のsummaryは自動で`(非公開)`になる。再現手順を記録やログに書かない（公開リポジトリのため）。

## 自動投稿（`must` / `nit`）

この設計の承認（2026-09-26）により、`must`と同じ回の`nit`は、ユーザーの了承を都度取らずに投稿してよい。

1. 1回のレビューで1コメント。先頭に`<!-- claude-review round=<n> -->`を入れる。指摘ごとに「何が起きるか → 期待 → 直し方の案」（#35の形）。
2. 本文に`(aside)`を入れない（Devinが対応しなくなる）。秘密・環境変数の値・ローカルのパスを書かない。
3. 範囲外の気づきは投稿しない（ユーザーに渡す）。
4. `gh pr comment <n> --body-file <file>`で投稿し、投稿時刻（`date -u +%Y-%m-%dT%H:%M:%SZ`）を控える。
5. **ローカルの委譲でも、通常は起動し直さない**。Devinは`devin-workflow` §4.5でPRのコメントを監視しているので、
   投稿すれば自分で気づいて直す。投稿しても反応が無いとき（セッションが終了・クラッシュした場合）は、
   上の「委譲」2と同じ確認をしてから、新しいローカルセッションを「ログ付きの起動」（同じIssue番号のログ）で起動して直させる
   （`devin -c`の再開は「failed to start ACP agent session」で動かなかった）。依頼は
   `"PR #<n>（ブランチ <branch>）を直す。gh pr view <n> --comments で claude-review round=<r> のコメントを読み、must を直して同じブランチに push する。force push はしない。"`。
   クラウドの委譲なら、DevinがPRのコメントに自動で対応するので起動しない。
6. `run_in_background`で`node .claude/scripts/wait-for-pr-update.mjs <PR> --since <投稿時刻> --sha <レビューした head>`を起動する。
   - 終了コード0: 更新あり。`ciConclusion`が`failure`なら、DevinがCIを直している途中のことがあるので、
     `--sha <その head>`でもう一度待つ（1回まで。続けて失敗したらユーザーに伝える）。`success` / `none`なら次のroundのレビューへ
   - 終了コード3: 時間切れ（既定4時間）→ ユーザーに伝える。Devinの反応（返信・コミット）が無いときは、監視が止まっている可能性も伝える
   - 終了コード4: PRが閉じた / マージされた → 「完了」へ

## レビュー完了のコメント（`merge`のとき）

ユーザーがPRを開いたときに、レビューが終わってマージしてよいかを見分けられるようにする（2026-10-09 ユーザーの指示）。
指摘を投稿しなかった回は、PRだけを見ても「まだレビューしていない」のか「終わった」のかがわからないため。

1. 判定が`merge`になったら、PRに1つコメントを付ける。先頭に`<!-- claude-review round=<n> verdict=merge -->`を入れる。
2. 本文は「レビュー完了。マージしてよい状態です」と、レビューしたhead（短いsha）・CIの結果・round 0からの回数を書く。
   `nit`があれば「細かい点はユーザーに渡した」とだけ書き、中身は書かない（後続Issueの案としてユーザーに渡す）。
3. 本文に`(aside)`を入れる（Devinが対応の要るコメントと取り違えないため）。
4. `escalate`のときは付けない。`security`の指摘があることも、ほかの指摘の中身も書かない。
5. このあとにpushがあって再レビューした場合は、その回の判定で同じ手順をくり返す。

## 直ったスレッドを解決済みにする

ユーザーがPRを開いたときに、どの指摘を見終わったかがわかるようにする（2026-10-09 ユーザーの指示）。
GitHubは、解決済みにしたスレッドをチェックの印で表示する。

1. round 1以降のレビューで、行に付いたレビューのスレッド（Codex・Devinのレビューなど）を読み、直ったことを差分で確かめたものを解決済みにする。
   直っていないもの、確かめられないものは開いたままにする。ユーザーが自分で書いたスレッドは、ユーザーに任せて触らない。
2. スレッドの一覧: `gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved comments(first:1){nodes{author{login} path body}}}}}}}' -f o=<owner> -f r=<repo> -F n=<PR>`。
3. 解決: `gh api graphql -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' -f id=<スレッドのid>`。
4. 自分（Claude Code）のPRで指摘を直して返信したときも、返信のあとに同じ手順で解決済みにする。
5. 行に付かない普通のコメント（`gh pr comment`）は解決済みにできないので、何もしない。

## セキュリティ指摘

PR・Issue・コメント・記録のどこにも詳細を書かない。`security`の指摘があることも書かない。ユーザーに渡し、経路を決めてもらう。推奨の順:

1. 未マージ（mainに入っていない）なら、Devinの新しいセッションをCLIで起動し、PRには書かずに直させる。
   ローカルのセッション（上の「委譲」2の「ログ付きの起動」）が既定。PRに書かないので、指摘の中身はプロンプトだけで渡す
   （依頼は`"<ブランチ名> に push して直す。…"`）。ログは0600で、ほかの利用者からは読めない。
2. Devinの監視が止まっているか直せないときは、Devinの作業が終わっているのを確かめてから、Claudeが同じブランチにcommitする。
3. mainに入っている問題なら、GitHubのSecurity Advisory（非公開）で扱う。

修正がpushされたら、`wait-for-pr-update.mjs`で待って再レビューする（roundを1つ進める）。

## 完了（マージ・クローズの後）

1. `node .claude/scripts/delegation.mjs finalize <Issue>`（PRが見つからなければ`--pr <n>`。IssueなしPRは`finalize pr-<n>`）。
2. 記録はDevinのブランチにcommitしない。その日の締め（close-session）のPRに、finalizeした記録（`outcome`がmerged / closed）だけを入れる。
   進行中の記録は写しで次のセッションに引き継ぐので、コミットしない（別のworktreeのセッションと同じ記録を二重にコミットして、
   closeのPRどうしが衝突するのを避けるため）。写しが残らないクラウドのセッションでは、今までどおり進行中の記録もコミットする。
3. `node .claude/scripts/delegation.mjs summary`で昇格候補が出たら、`improvement-cycle.md`の
   「委譲ループの軽量サイクル」に従って候補を起票する。

## 報告

- PRごとに「マージ可 / 手直し中（round n）/ ユーザーの判断が必要」を先に書き、根拠・再現結果・後続への申し送りを続ける。
- マージはユーザーが行う。Claude Codeはマージしない。
- 衝突の解消を頼まれたら、worktreeでmainを取り込み、両方の記述を残して解消し、lint・型・テストを通してからpushする。
  修正中のエージェントがいるブランチには、同時にコミットしない。
