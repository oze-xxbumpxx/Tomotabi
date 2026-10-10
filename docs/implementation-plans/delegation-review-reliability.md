# 実装計画: delegation-review-reliability

- 前提となる設計書: [委譲の共有受付と最終版のレビュー確認](../designs/delegation-review-reliability.md)
- 関連: [要件](../requirements/delegation-review-reliability.md)、[ADR-0007](../decisions/ADR-0007-github-delegation-and-review-state.md)、[試験計画](../tests/delegation-review-reliability.md)
- レベル: L3 / ユーザー承認: 必要（設計承認済み。承認の経緯は論点の記録で確認する）
- 実装ルート: Orchestrator（implementer）
- 判断理由: AGENTS.mdの既定。Codex委譲用のブリーフは未導入のため、共通の実装計画から担当を分ける。

共有状態、レビュー判定、起動と既存手順の接続を分けて実装する。実装PRには未初期化の設定を入れ、管理Issueの作成と必須チェックの追加は、ユーザーが実装をマージした後に行う。

## 変更対象ファイル

| パス | 変える理由 |
| --- | --- |
| `.claude/scripts/delegation.mjs` | request/importの受付、共有状態からの写し、旧YAMLと集計の維持 |
| `.claude/scripts/delegation-status.mjs` | 共有状態のseq・取得日時・未確認理由と次の操作を表示する |
| `.claude/scripts/wait-for-pr.mjs` | 共有状態のPRを優先し、複数候補を最小番号で選ばない |
| `.claude/scripts/wait-for-pr-update.mjs` | CI待ちからagent-reviewを除き、自己依存を避ける |
| `.claude/scripts/wait-for-devin-pr.mjs` | 共有登録済みPRを照合し、コメントの印だけで完了扱いしない |
| `.claude/hooks/delegation-status.mjs` | 更新したstatusと接続し、取得失敗でも履歴表示を保つ |
| `.claude/hooks/suggest-pr-watch.mjs` | 直接起票後のinitを起動許可とする誘導を、共有受付と照合へ変える |
| `.claude/skills/review-devin-pr/SKILL.md` | 共通受付・ラッパー・完全SHA・Codex再確認の手順へ変える |
| `.claude/skills/close-session/SKILL.md` | 共有状態の照合と、完了YAMLの引き継ぎ手順を揃える |
| `.agents/skills/devin-workflow/SKILL.md` | 登録されたIssue・起動試行・PRの対応と再レビューを案内する |
| `AGENTS.md` | 共通受付、結果不明時の停止、ユーザーのマージ判断を明記する |
| `docs/claude-code/improvements/delegations/README.md` | 共有状態とYAMLの役割、追加項目、移行・復旧を説明する |
| `docs/devin-setup.md` | 直接CLI起動の説明とCloudの既定値の断定を新手順に揃える |
| `.claude/tests/delegation.test.mjs`、`delegation-status.test.mjs` | 旧形式・集計・共有状態優先と縮退表示の回帰を確認する |
| `.claude/tests/wait-for-pr.test.mjs`、`wait-for-pr-update.test.mjs`、`wait-for-devin-pr.test.mjs`、`suggest-pr-watch.test.mjs` | 候補の曖昧さ、CI待ち、Hookの案内の回帰を確認する |

`.agents/skills/close-session`は既存の`.claude/skills/close-session`へのリンクを使う。複製は作らない。`apps/`、`packages/`、既存のci/e2e workflowとpackage.jsonは変更しない。

## 新規作成ファイル

| パス | 役割 |
| --- | --- |
| `.claude/config/delegation-review.json` | 固定repo・作者ID・writer・管理Issue・上限・移行状態 |
| `.claude/scripts/delegation-shared.mjs` | 要求検証、正規化とhash、履歴検証、状態遷移、共有状態のクライアント |
| `.claude/scripts/delegation-github.mjs` | gh通信、REST/GraphQLの全ページ取得、再試行とAPI予算 |
| `.claude/scripts/delegation-control.mjs` | 単一writerの実行、要求の再配送、起票、レビューcheckの更新 |
| `.claude/scripts/agent-review.mjs` | レビュー証拠の収集・純粋判定・Claude完了JSONの生成 |
| `.claude/scripts/delegation-launch.mjs` | claim/begin/started、spentの保存、既存CLIの1回起動 |
| `.github/workflows/delegation-control.yml` | mainの制御コードによる受付と更新を直列化する |
| `.github/workflows/delegation-events.yml` | PR/reviewイベントを読み取り専用の通知artifactへ写す |
| `.claude/tests/delegation-shared.test.mjs`、`delegation-github.test.mjs`、`delegation-control.test.mjs` | 状態・通信・writerの途中失敗を差し替えI/Oで試す |
| `.claude/tests/agent-review.test.mjs`、`delegation-launch.test.mjs`、`delegation-workflows.test.mjs` | 証拠・spawn・workflowの権限境界を試す |

## ファイルごとの変更内容

### 共有状態を担当するファイル

- `.claude/scripts/delegation-shared.mjs`の変更内容: schema_version=1の要求・状態・結果を定義する。整数のみの再帰的なキー順正規化、task本文のLF化、SHA-256、seq/prev_hash/hash、先頭位置の検証と連続した末尾の回復を作る。journalは48KiB以内の差分イベントにし、全state snapshotを毎回書かない。公開投影は指摘本文・raw prompt・生ログを含めない。
- `.claude/scripts/delegation-shared.mjs`の完了条件: 同一request_idの同内容は外部操作を繰り返さず、別内容はrequest_conflict。同一task_keyの別digestと取り下げ済みキーは登録・claimできない。beginの再配送はalready_begunで許可を再発行しない。
- `.claude/scripts/delegation-github.mjs`の変更内容: シェルを介さずghへJSONを渡す。REST/GraphQLのページ送り、User/BotのdatabaseId、commitとworkflow run取得、10秒timeout、読み取りの最大3回再試行、Retry-After最大30秒、job内200回の予算とrunキャッシュを共通化する。POSTの応答不明は自動再送しない。
- `.claude/scripts/delegation-github.mjs`の完了条件: 途中取得失敗・上限到達を完了した集合として返さない。gh無し・未認証では書き込みを止め、未接続MCPの代替を作らない。秘密をエラーや公開投影へ出さない。
- `.claude/scripts/delegation-control.mjs`の変更内容: runのrepo/head_repository、固定workflow ID/path、event、main branch、保護されたmain履歴のhead_sha、run_attemptを確認する。要求作者を固定IDで認証し、ID順に最大20件を処理する。履歴追記→先頭更新→双方の再読込後に外部操作する。
- `.claude/scripts/delegation-control.mjs`の完了条件: issue_creatingと試行IDを先に保存する。作成応答不明は全状態Issueの印を照合し、0件でも再作成せず、複数件なら止める。共有状態を読めなければ、起票・許可・check成功を出さない。

### レビューを担当するファイル

- `.claude/scripts/agent-review.mjs`の変更内容: 同じ完全head SHAのOPEN PR全件と対象判定を集める。作者ID・devin/・共有状態／旧委譲登録のORと、finalizedまでの対象保持を使う。Claude、Codexの完了・指摘・編集者を読み、本文はメモリでhashにする。
- `.claude/scripts/agent-review.mjs`の完了条件: Claudeの未編集の新規完了、現在headのCodex完了、解決済みスレッド、行外指摘IDの確認、現在のcodex_evidence_hash一致をすべて要求する。旧SHA・引用・開始反応・他者編集・取得欠落・集合変化をsuccessにしない。
- checkの変更内容: agent-reviewは判定結果と公開check payloadを返す。Checks APIの作成／更新はcontrollerだけが行い、共有状態にSHAごとのcheck IDを保存する。完了JSON生成のCLIは公開JSONを返し、コメント投稿を自動では行わない。
- checkの完了条件: 実行開始時に以前のsuccessをin_progressへ戻す。書き込み直前にOPEN PR集合と全証拠を再取得して照合し、Draft／未確認はin_progress、不足・破損はfailure、全対象成立だけsuccess。旧SHAと新SHAの集合を両方再判定する。

### 起動と設定を担当するファイル

- `.claude/config/delegation-review.json`の変更内容: repo ID1359576461、要求／Claude ID109064833、Codex ID199175422、Devin ID158243242、Actions ID41898282を固定する。管理Issue・先頭コメント・未確認workflow IDはnull、migration_completeはfalseで入れる。設定の版と設計の取得上限も定義する。
- `.claude/config/delegation-review.json`の完了条件: 未初期化設定では履歴表示へ縮退し、register/claim/beginと成功判定を許可しない。初期化済みでmigration_complete=falseなら移行用importと照合だけを進め、新規起動は止める。
- `.claude/scripts/delegation-launch.mjs`の変更内容: runner/model/prompt-fileを明示入力にし、既存CLIの--prompt-fileへ渡す。実行ごとに新しいactivation_idを作り、claimのattemptを受けた同一実行でbeginを1回送る。受領コメントID、制御run/attempt、caller/attempt/activationが結び付いた初回結果だけを消費する。
- `.claude/scripts/delegation-launch.mjs`の完了条件: CLI直前にメモリガードと信頼できる状態ディレクトリのactivation_id.spentを排他作成する。保存失敗・begin応答喪失・終了・15分超過・spawn後の保存失敗で再起動せずunknownにする。新API認証を追加せず、Cloudの実測modelは確認不能ならunknown。

### 既存CLI・待機・Hookを担当するファイル

- `delegation.mjs`の変更内容／完了条件: request/importを追加し、公開JSONと終了コード0/2/3/4/5を扱う。init/review/finalizeの既存終了コード、Issue番号／pr-N、reviews、follow_up_of、summaryを保つ。共有seq・取得日時・session/attempt/PRの対応は任意項目で写し、旧initを起動許可にしない。受付後とstatus取得後に状態ディレクトリへYAMLの写しを作り、旧review/finalizeへ接続する。古いseqでは更新せず、既存のreviewsやfollow_up_ofを保つ。
- `delegation-status.mjs`の変更内容／完了条件: 読めた共有状態を優先する。reviews数による選択は旧記録同士に限る。古い写しは未確認と表示し、短縮SHAの前方一致をレビュー成功にしない。未処理・起票結果不明・起動結果不明・現在headへのCodex再依頼・再確認を案内する。
- `wait-for-pr.mjs`の変更内容／完了条件: 共有登録のPRを優先し、GitHub上のIssue対応を確認する。複数候補は競合として返し、勝手に最小番号を選ばない。旧呼び出し元と試験も新しい曖昧状態を扱う。
- `wait-for-pr-update.mjs`の変更内容／完了条件: agent-reviewをCIの待ちと結論から除く。quality/build/api-dbを維持し、PR headとCIのmerge commitを単純一致させない。
- `wait-for-devin-pr.mjs`の変更内容／完了条件: 登録済みPRと確認済み証拠を使う。旧形式の印は履歴表示に残せるが、単独で未確認PRを隠さない。gh無しでは既存の縮退を保つ。
- `hooks/delegation-status.mjs`の変更内容／完了条件: collectStatusの非同期化が必要ならawaitで接続する。Hookは起動せず、失敗してもexit 0で履歴と未確認を表示する。
- `hooks/suggest-pr-watch.mjs`の変更内容／完了条件: 直接作成されたIssueはimport/照合を案内する。init→直接起動を勧めず、自分で実装するIssueは委譲扱いにしない。

### workflow・手順・試験を担当するファイル

- `delegation-control.yml`の変更内容／完了条件: issue_comment(created/edited/deleted)、main限定dispatch、毎時schedule、指定したevents/ci/e2eのworkflow_run(completed)を受ける。初期化専用のinitializeは固定担当者の手動dispatchでActions作者の先頭コメントを作る。group=tomotabi-delegation-control、queue=max、cancel-in-progress=false、timeout=5分。contents:read/issues:write/pull-requests:read/checks:write/actions:readだけを与える。mainのコードだけを実行し、PRコード・要求ref・npm scriptを実行しない。
- `delegation-events.yml`の変更内容／完了条件: 設計のPR/reviewイベントでcheckoutせず、PR番号・event・run IDのみを固定名JSON artifactへ保存する。書き込み権限は与えない。controllerは8KiB以下の指定JSONを検証し、任意zip pathに展開せず現在のGitHub状態を取り直す。
- skills、AGENTS.md、委譲README、devin-setup.mdの変更内容／完了条件: 共通受付とラッパーを唯一の新規委譲手順にする。停止の見張り後の自動再起動をやめ、結果不明は照合へ渡す。Codexの明示依頼、完全SHAの未編集完了、agent-reviewを除くCI確認、マージ前review-refreshを揃える。未知のCloud既定値とbot依頼を保証しない。
- 新規6試験と既存6試験の変更内容／完了条件: [試験計画](../tests/delegation-review-reliability.md)の担当範囲を追加する。Node標準testとI/O差し替えを使い、本物のgh書き込み・Devin起動・アプリworkspaceのテスト追加をしない。

## 実装手順

### 1. 担当間の境界と設定の初期値を固定する

- 対象ファイル: delegation-shared.mjs、delegation-github.mjs、agent-review.mjs、delegation-review.json。
- 変更内容: A/B/Cで共通schemaと下表の呼び出し境界を固定する。時計、通信、spawnは差し替え可能にする。configのキー名とsnake/camelの表記は着手時に固定し、他担当へ通知する。
- 完了条件: snapshotはseq/hash/取得日時とtasks/requests/prs/checksを持つ。prsには前回headと対象保持、checksにはSHAごとのcheck IDを置く。結果はrequest ID/内容hash/コメントID・制御run/attemptを結び、begin再配送を許可と区別する。未初期化の設定で外部操作が0回である。

| 担当 | 固定する共通境界 |
| --- | --- |
| Aのtransport | createGitHubClient({repo,...})がasync rest(method,path,body)、graphql(query,variables)、paginate(path,{maxPages,maxItems,key})を返す |
| Aのshared | readSnapshot(client,config)、submitRequest(client,config,request)、waitForResult(client,config,{requestId,commentId,activationId,...}) |
| Bのreview | collectReviewSnapshot(client,config,headSha,{registeredPrs})、evaluateSha(snapshot,config)、createClaudeCompletion |
| AのwriterとB | Bは収集した集合・集合hash・判定と公開check payloadを返す。Aが再取得して比較し、check IDを保存してChecks APIへ書く |

### 2. 共有状態と受付を実装する（担当A）

<!-- delegation-task:shared-state -->
委譲の要求と共有履歴を実装する。設計の「共有状態の保存先」「API設計」「エラー処理」を読む。

- 対象ファイル: delegation-shared.mjs、delegation-github.mjs、delegation-control.mjsと、それぞれの新規test.mjs。
- 変更内容: register/claim/begin/started/link-pr/import/reconcile/review-refreshを検証する。公開main計画の一意なタスク印、承認記録、完全plan SHA、本文digestと開始条件を確認する。受付結果の保持、writer/run認証、先頭位置の回復、issue_creating→起票→照合を作る。
- 完了条件: 二重配送と並行claimでIssue作成とattempt確保が各1回以下。曖昧な起票、履歴欠落・分岐・偽run、上限到達では止まる。未処理要求がID順のdrainに残り、begin許可は再発行されない。
- 試験: 3つの新規test.mjsで純粋遷移と通信・writerの途中失敗を試す。controllerのreview処理は担当Bの読み取り判定へ接続し、書き込み責任はcontrollerに置く。
<!-- /delegation-task -->

### 3. レビュー証拠とSHA単位の判定を実装する（担当B）

<!-- delegation-task:review-evidence -->
最終版の両レビューと対象指摘を確認する。設計の「レビューの判定」「性能」「セキュリティ」を読む。

- 対象ファイル: agent-review.mjs、agent-review.test.mjs。
- 変更内容: author/editor/lastEditedAt/updatedAt、formal reviewのsubmitted/commit、summaryの一意な完全SHA解決を取得する。Codex指摘全件と未解決旧headを含めてhash化し、Claudeの最新の有効な新規完了と照合する。同じheadを持つOPEN PR全件をまとめる。
- 完了条件: PR固有の証拠をSHAの全対象PRで要求する。対象外だけのsuccess、outdatedだけの解決、編集済みClaude完了、曖昧なsummary、欠落したページを成功にしない。書き込み前に比較できる集合hashと公開check payloadをcontrollerへ返す。
- 試験: agent-review.test.mjsで編集者、同一SHA、証拠追加／削除／dismiss、再開、Draft、各取得上限を試す。完了JSONの生成は本文を公開状態へ複製しない。
<!-- /delegation-task -->

### 4. 起動と既存手順を接続する（担当C）

<!-- delegation-task:launch-integration -->
既存CLIを共有受付と1回起動の手順へ接続する。設計の「beginの許可を再利用しない」「移行とリリース」を読む。

- 対象ファイル: delegation-review.json、delegation-launch.mjs、既存CLI/status/wait/Hook、skills、2つの新規workflow、AGENTS.md、委譲README、devin-setup.md、担当する新規・既存試験。
- 変更内容: runner/model/prompt-fileを明示して共通受付を呼ぶ。beginの初回結果とspentでspawnを守り、既存devin-watchの非公開ログへ接続する。共有状態をYAMLへ写し、statusと待機、CIの自己依存、手順、workflowを揃える。
- 完了条件: 再実行・応答喪失・保存失敗でspawnは各activationにつき1回以下。共有状態が未初期化／未確認の間は新規起票・起動を止める。listenerに書き込みを与えず、controllerはmainコードだけを実行する。既存YAMLと集計が読める。
- 試験: delegation-launch.test.mjs、delegation-workflows.test.mjsと既存6試験を通す。子プロセスはスタブにし、Devin API・全自動起動・Merge Queueを追加しない。
<!-- /delegation-task -->

### 5. 全体を結合して実装PRをレビューへ渡す

- 対象ファイル: 3担当の全変更、実装計画、試験計画、既存要件・設計・ADR・論点の記録。
- 変更内容: register→起票→claim→begin→started→PR→両レビュー→finalizeを差し替えI/Oで通す。controllerの再検証とcheck更新、旧／新SHA、未処理通知、100件を超える要求を結合確認する。
- 完了条件: ハーネス全件と空白チェックが通る。構成変更を重点レビューし、未実施の実機確認をPRへ残す。未初期化設定を保ち、管理Issue作成・必須設定・本物の起動は行わず、マージをユーザーへ渡す。

### 6. マージ後に共有状態を初期化して移行する

- 対象: GitHubの管理Issue・先頭位置コメント、delegation-review.json、委譲READMEの移行記録。
- 変更内容: ユーザーのマージ後、管理Issueを作り、controllerの実在workflow IDとmain実行元を確認する。設定PRでこの2つを固定し、手動dispatchのinitializeでActions作者の先頭コメントを作る。既存コメントや作成結果不明を照合し、先頭コメントIDを設定PRに保存する。進行中の計画／Issue／PR／Local・Cloudセッションを照合してimportする。固定担当者が移行結果を確かめ、設定PRでmigration_completeを変える。
- 完了条件: 不明なセッションと起票はunknownのまま記録する。未登録を未着手と推測しない。移行完了を確かめるまでregister/claim/beginを解放しない。管理Issueの作成前に同じ目的の既存Issueが無いかを確認する。

### 7. 実機確認後にagent-reviewを必須にする

- 対象: ユーザー管理の確認PR、2つのworkflow、設定、Protect-main（ID23977008）。
- 変更内容: 明示checkのPR関連付け、現在headの両レビュー、不足証拠、同一SHA、編集者、head更新、close/reopen、controllerの各eventとlistener通知を確認する。CLIのセッション取得形式と内部起動POST再送設定は読み取りで調べる。Devin CLI3000.11.3の--prompt-fileとlist --format jsonは存在を確認済みだが、Cloudの対応付けと内部再送は別に確認する。
- 完了条件: [試験計画](../tests/delegation-review-reliability.md)の導入条件を満たす。Checks APIで成立しなければ設計へ差し戻し、同名statusを追加しない。ユーザー承認の範囲でagent-reviewだけを必須に足し、quality/build/api-dbを維持する。本物のDevin起動による試験は行わない。

## 依存関係

境界と設定の固定後、担当A/B/Cは自分のファイルを並行して実装できる。BとCはAの共有境界を使う。AのcontrollerはBの判定を呼ぶため、全体結合は3担当の完了後に行う。

順序は「境界固定→3担当の実装→結合と独立レビュー→ユーザーの実装マージ→初期化とimport→設定PRで移行完了→実機check確認→ユーザーの必須設定」である。アプリworkspaceの変更や依存パッケージ追加は無い。公開計画のタスク登録は承認済みmain版だけを読み、本計画の作業ブランチ版を起動根拠にしない。

## テスト計画

配置と観点は[試験計画](../tests/delegation-review-reliability.md)に合わせる。ハーネスの`.mjs`は既存のNode標準testで検出される。Vitestのworkspaceには追加しない。

- 担当A: delegation-shared/github/controlの3試験。正規化・要求競合・履歴と先頭・真正なrun・起票不明・要求drain・全ページと予算を確認する。
- 担当B: agent-reviewの試験。現在head・編集者・全Codex指摘・同一SHA集合・再取得の差を確認する。
- 担当C: launch/workflowsの2試験と既存delegation/status/wait-for-pr/wait-for-pr-update/wait-for-devin-pr/suggest-pr-watchの6試験。spawn前後の中断、縮退、互換、権限とrefを確認する。
- 結合: `HARNESS_NAMESPACE=tomotabi-harness node --test .claude/tests/*.test.mjs`と`git diff --check`。実物の管理Issueや外部セッションへ書かない。アプリ品質コマンドはアプリ変更が無いため省略し、既存CIのチェックは維持する。
- 導入: 確認PRの結果と完全SHA・証拠URL・workflow runを移行記録へ残す。未確認のライブcheck適格性、Cloud CLI内部再送、Codex設定を自動試験の成功で代用しない。

## リスク

| リスク | 検出と対応 |
| --- | --- |
| 境界の食い違いで3担当の結合が止まる | 最初にschemaと境界を固定し、変更が要る場合は他担当へ伝えてから変える |
| コードがマージされても起票できない | 未初期化を意図した初期値として説明し、初期化とimportを終えて設定PRを出す |
| 公開コメントやエラーへ秘密が出る | 公開投影と本文hashを試験し、raw prompt・生ログ・指摘本文を出す経路を削る |
| checkの実機適格性やCLI形式が成立しない | 導入を止め、Checks APIの代替statusや推測のsession IDを足さず設計へ戻す |
| 起動していなくてもunknownになる | spent・予約を残して読み取りで照合する。時間経過だけで新しいattemptを作らない |
| 非同期イベントで古いsuccessが短時間残る | scheduleと明示review-refreshで照合し、マージ前に未処理通知が無いことを確認する |
| 管理Issueの履歴・API上限を使い切る | 上限付近で通知し、新規処理を止める。自動削除や別Issueへの移動をしない |

## ロールバック方法

新しい受付と起動を停止し、進行中のIssue・attempt・activation・セッション・PRを読み取りで照合する。unknownの担当を解放せず、管理Issue、履歴、先頭位置、spent、生ログを保管する。共有状態を旧YAMLの任意項目へ写して履歴を引き継ぐ。

必須化の後は、ユーザーがProtect-mainからagent-reviewだけを外すか判断する。quality/build/api-dbは残す。コードを戻す場合は作業ブランチのrevert PRをユーザーへ渡す。戻したコードから直接起動を再開せず、セッション照合後にユーザーが運用を選ぶ。mainの履歴改変、外部セッションの停止／削除、管理Issueの削除は行わない。

## ドキュメント更新対象

review-devin-pr、close-session、devin-workflow、AGENTS.md、委譲README、devin-setup.mdを実装PRで揃える。初期値、設定項目、終了コード、移行、復旧、マージ前review-refreshを説明する。試験計画には自動試験と実機の未確認を区別して結果を残す。

設計・要件・ADRは採用方針を増やさず、実装時の差異が必要なら承認工程へ戻す。論点の記録とprogress、日次ログ、PR説明はOrchestratorが更新する。ドメインモデルとアプリ契約は対象外である。
