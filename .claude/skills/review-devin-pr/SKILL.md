---
name: review-devin-pr
description: >
  Devinなど他のエージェントがIssueから作ったPRを、Claude Codeがレビューし、
  指摘 → Devinの修正 → 再レビューのループを上限付きで回す手順。共通受付で登録した後に
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

## 委譲は共通受付から進める

設計は`docs/designs/delegation-review-reliability.md`。管理Issueの履歴を確かめてから起票・起動する。ローカルYAMLの`init`は履歴用で、起動許可にはならない。

公開計画のタスク本文は`.github/ISSUE_TEMPLATE/devin-task.md`の節に沿って書く。「やること」「やらないこと」「完了条件」「試験項目」「申し送り」を入れ、Devinが依頼範囲を読める形にする。後続の修正は「元のPR」を書く。controllerは承認済み計画の一意な区間をIssue本文へ写し、要求のdigestと照合する。

既知の指摘は、関係する領域だけタスク本文の「既知の指摘」へ写す。すべての委譲に共通する予防は`devin-workflow`へ置く。

| 領域 | 予防の1行 | 出典 |
| --- | --- | --- |
| E2E | 日付は今日から数えて作り、年や日を決め打ちしない。要素は役割・見出し・ラベルで探し、クラス名で探さない。APIを模擬したら、外す条件をPRの説明に書く | #100・#128・#152・#158 |

1. 承認済みの公開計画に、一意な`delegation-task`区間を置く。公開JSONに`schema_version:1`、`operation:register`、UUIDの`request_id`、`task_key`、`plan_path`、完全な`plan_sha`、`task_digest`を書く。設計承認・先行タスク・作業場所など開始条件を確かめた場合だけ`start_conditions_confirmed:true`を付ける。本文には秘密や非公開の指摘を入れない。
2. `HARNESS_NAMESPACE=tomotabi-harness node .claude/scripts/delegation.mjs request --request-file <公開JSON>`で登録する。同じ要求は同じIDと内容で照合する。直接`gh issue create`を使って委譲を始めない。
3. `status --json`でIssueとタスクの対応を確かめる。既存のIssue・PR・セッションは`import --request-file <公開JSON>`で照合する。移行未完了、共有状態の取得失敗、内容競合では起動しない。
4. 専用クローンに前のプロセスや変更が残っていないか先に確認する。残っていたら捨てずにユーザーへ渡す。非公開prompt fileを0600で作る。SWE-2のeffortは難しさで選び、依頼時にユーザーへ伝える。起動は`HARNESS_NAMESPACE=tomotabi-harness node .claude/scripts/delegation-launch.mjs <task_key> --runner local --model swe-2-<effort> --prompt-file <非公開ファイル> --clone <専用クローン>`。runner/modelは省かない。ローカルを既定の選択とし、Cloudはユーザーが指示したときに`--runner cloud`を使う。Cloudの実モデルは確認できるまで`unknown`とする。
5. promptにはリポジトリ内での作業、force push・ブランチ削除・履歴改変・mainへのpushの禁止と、PR後の監視を含める。生ログは既存`devin-watch`と同じ非公開ファイルに残る。
6. 起動ラッパーは新しいactivationでbeginを1回だけ送り、初回受領を照合してからspentを排他的に保存する。spentやactivationを削除・再利用しない。送信・保存・起動結果が不明なら、自動で再送・再起動しない。15分の期限超過やstallの通知も照合の契機に限る。
7. `wait-for-pr.mjs <Issue>`と、セッション1本の`wait-for-devin-pr.mjs --since <UTC時刻>`でPRを待つ。複数の対応候補から番号の小さいPRを選ばない。PRが見つかったら共通受付の`link-pr`で対応を確かめ、以下のレビューへ進む。

導入前の`migration_complete:false`と`cli_launch_verified:false`は停止する設定である。CLI内部の起動POST再送とセッション形式の実機確認を、stub試験の成功で済ませたことにしない。

## レビュー（round 0は全体、round 1以降は前回のレビュー以降の差分）

1. **状態**: `gh pr view <n> --json files,statusCheckRollup,mergeable,body,headRefOid`。quality・build・api-dbなど既存CIの結果を確認する。agent-reviewはCIの待機と集計から外す。現在headへのCodex完了とClaude完了は別に確認する。
   続けて、今のheadへのCodexのレビューを頼む: `node .claude/scripts/codex-review.mjs request <n>`。
   CodexはボットのPR（Devin）を自動ではレビューせず、pushのあとも見直さないため、round 0とround 1以降の毎回、Claudeのレビューを始める前に頼む
   （2026-10-10 ユーザーの指示）。投稿は手元のghの認証（ユーザーのアカウント）で行い、今のheadが完了・実行中のときや、headより後に依頼済みのときは投稿しない。
   Codexの完了は待たずに自分のレビューを進め、`merge`の判定の前に`run_in_background`で`node .claude/scripts/codex-review.mjs wait <n> --sha <head>`を起動して待つ。
   Codexの指摘は、自分の指摘と同じ分類（must / nit / security / decision）で扱う。
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
   作成者によるrunnerの推定は旧履歴の表示だけに使う）。共通受付へimportし、runner/modelは対応を確認して明示する。
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
| `must`なし | `merge` | 下の「レビュー完了のコメント」を付ける。現在headの両レビューとagent-reviewを確認してから、ユーザーへマージ判断を渡す（`nit`は後続Issueの案として添える） |

どの場合も、記録に追記する:
`node .claude/scripts/delegation.mjs review <Issue> --round <n> --sha <レビューした head> --verdict <merge|fix|escalate> [--posted] --finding '<severity>:<category>:<summary>' …`。
`security`のsummaryは自動で`(非公開)`になる。再現手順を記録やログに書かない（公開リポジトリのため）。

## 自動投稿（`must` / `nit`）

この設計の承認（2026-09-26）により、`must`と同じ回の`nit`は、ユーザーの了承を都度取らずに投稿してよい。

1. 1回のレビューで1コメント。先頭に`<!-- claude-review round=<n> -->`を入れる。指摘ごとに「何が起きるか → 期待 → 直し方の案」（#35の形）。
2. 本文に`(aside)`を入れない（Devinが対応しなくなる）。秘密・環境変数の値・ローカルのパスを書かない。
3. 範囲外の気づきは投稿しない（ユーザーに渡す）。
4. `gh pr comment <n> --body-file <file>`で投稿し、投稿時刻（`date -u +%Y-%m-%dT%H:%M:%SZ`）を控える。
5. Devinが監視中なら、投稿に対する修正を待つ。反応が無い場合もセッションを自動再起動しない。共有状態と既存プロセス／セッションを読み取りで照合する。結果不明はユーザーへ渡し、復旧の判断後も共通受付を使う。
6. `run_in_background`で`node .claude/scripts/wait-for-pr-update.mjs <PR> --since <投稿時刻> --sha <レビューした head>`を起動する。
   - 終了コード0: 更新あり。`ciConclusion`が`failure`なら、DevinがCIを直している途中のことがあるので、
     `--sha <その head>`でもう一度待つ（1回まで。続けて失敗したらユーザーに伝える）。`success` / `none`なら次のroundのレビューへ
   - 終了コード3: 時間切れ（既定4時間）→ ユーザーに伝える。Devinの反応（返信・コミット）が無いときは、監視が止まっている可能性も伝える
   - 終了コード4: PRが閉じた / マージされた → 「完了」へ

## レビュー完了のコメント

現在headへのCodex完了、対象スレッドの解決、行外指摘の確認を全件確かめる。Codexの開始を示す目の反応や、指摘が無いという推測は完了にならない。Codexの完了が古い版なら、`codex-review.mjs request`で今のheadへ頼み直し、`codex-review.mjs wait`で完了を待つ（上の「レビュー」の1）。終了コード3（時間切れ）・5（Codexの失敗）はユーザーに伝える。

1. 完全な40桁head SHAと、現在のCodex証拠集合のhash、確認した証拠ID／URLを取得する。指摘本文やsecurityの有無は完了JSONへ複製しない。
2. `schema_version`、`pr`、`head_sha`、`verdict`、`codex_evidence_hash`、`codex_evidence`（完了証拠ID／URLの配列）、`acknowledged_finding_ids`（確認した行外指摘IDの配列）、`reviewed_at`を公開JSONに書く。`node .claude/scripts/agent-review.mjs completion --input <JSON-file>`の出力をファイルへ保存し、`gh pr comment <PR> --body-file <完了ファイル>`で新規投稿する。固定Claude担当の作者IDと、未編集の投稿だけが採用される。
3. 間違いの修正やpush後の再レビューでは、前の完了を編集せず、新しい完了を投稿する。短いSHAや旧`claude-review`の印は成功の証拠にしない。`fix`／`escalate`は成功にならない。
4. 共通受付の`review-refresh`で最新の証拠を照合する。Codex指摘の追加・編集・削除・再開、head更新ではClaudeも再確認する。agent-reviewは同じSHAを使う対象PR全件の証拠が揃うまで成功しない。
5. マージ前にもう一度`review-refresh`の完了を確認し、`delegation.mjs status --json`で共有状態とChecks APIの両方を読み直す。未処理通知、controllerのI/O中断、既存CI、現在headのagent-reviewを確認する。check更新に失敗するとGitHubに古い成功が残り得るため、成功表示だけでマージ判断を渡さない。チェックの成功後も、PRのマージはユーザーが行う。

## 直ったスレッドを解決済みにする

ユーザーがPRを開いたときに、どの指摘を見終わったかがわかるようにする（2026-10-09 ユーザーの指示）。
GitHubは、解決済みにしたスレッドをチェックの印で表示する。

1. round 1以降のレビューで、行に付いたレビューのスレッド（Codex・Devinのレビューなど）を読み、直ったことを差分で確かめたものを解決済みにする。
   直っていないもの、確かめられないものは開いたままにする。ユーザーが自分で書いたスレッドは、ユーザーに任せて触らない。
2. スレッドの一覧（100件を超えても全部取るため`--paginate`で続きを読む）: `gh api graphql --paginate -f query='query($o:String!,$r:String!,$n:Int!,$endCursor:String){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{id isResolved comments(first:1){nodes{author{login} path body}}}}}}}' -f o=<owner> -f r=<repo> -F n=<PR> --jq '.data.repository.pullRequest.reviewThreads.nodes[]'`。
3. 解決: `gh api graphql -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' -f id=<スレッドのid>`。
4. 自分（Claude Code）のPRで指摘を直して返信したときも、返信のあとに同じ手順で解決済みにする。
5. 行に付かないCodex指摘は解決済みにできない。確認した証拠IDを完了JSONへ記録し、現在の全件と照合する。

## セキュリティ指摘

PR・Issue・コメント・記録のどこにも詳細を書かない。`security`の指摘があることも書かない。ユーザーに渡し、経路を決めてもらう。推奨の順:

1. 未マージ（mainに入っていない）なら、ユーザーが復旧を判断した後、共通受付で修正タスクと既存セッションを照合する。指摘の中身は非公開prompt fileだけで渡す。直接CLIを起動しない。ログは0600で残す。
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
