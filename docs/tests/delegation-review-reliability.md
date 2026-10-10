# 試験計画: delegation-review-reliability

- 前提となる設計書: [委譲の重複防止と最終版のレビュー確認](../designs/delegation-review-reliability.md)
- 要件: [要件定義](../requirements/delegation-review-reliability.md)、判断: [ADR-0007](../decisions/ADR-0007-github-delegation-and-review-state.md)
- レベル: L3
- 作成日: 2026-10-09
- 状態: 実装前の試験計画。試験結果と導入確認は未記録。

同じ作業の起票と起動を重ねず、現在headの両レビューと対象指摘の確認が揃った場合だけ成功することを確かめる。

## 試験種別

純粋な要求検証・状態遷移・証拠集合は単体試験にする。GitHub通信、履歴保存、CLI、排他的なspent作成、workflowの接続は結合試験にする。GitHub応答、時刻、待機、子プロセスを差し替え、実IssueやDevinセッションを作らない。

実装計画に合わせ、次のファイルを新設する予定。現在は未実装であり、export名は実装後に網羅表へ追記する。

| 新設予定の試験 | 主な範囲 |
| --- | --- |
| `.claude/tests/delegation-shared.test.mjs` | 要求、正規化、履歴、状態遷移（U-01〜U-15、U-28） |
| `.claude/tests/delegation-github.test.mjs` | GitHub通信、起票結果の照合、ページ送り、API予算（I-02〜I-07、I-13） |
| `.claude/tests/delegation-control.test.mjs` | 再配送、単一writer、移行、同じSHAの再判定（I-01、I-08、I-14〜I-17） |
| `.claude/tests/delegation-launch.test.mjs` | 初回許可の消費、spent、spawn、途中失敗（U-11〜U-15、I-09〜I-12） |
| `.claude/tests/agent-review.test.mjs` | 作者・編集者、完全SHA、完了と指摘集合（U-16〜U-27、I-14〜I-17） |
| `.claude/tests/delegation-workflows.test.mjs` | イベント、権限、固定ref、通知artifact（I-18〜I-20） |

Node 22で、リポジトリルートから`HARNESS_NAMESPACE=tomotabi-harness node --test .claude/tests/*.test.mjs`を実行する。`.test.mjs`は既存ハーネスのglobに含まれる。アプリのVitest・Playwright試験は増やさない。

## 単体試験観点

| # | 観点 | 前提 | 操作 | 期待結果 | 分類 |
| --- | --- | --- | --- | --- | --- |
| U-01 | 要求の必須値と版 | 正しい公開JSON | UUID、key、path、40桁plan SHA、64桁digest、版を空・不正へ変える | 拒否し、副作用なし。key各要素1/64字は許可、0/65字は拒否 | 正常/異常/境界 |
| U-02 | 命令の印と入力の隔離 | 正しい印、引用、任意文章、複数JSON、URL・shell文字列 | 要求を解析する | 専用形式だけを読む。引用や入力コードを実行しない | 正常/異常 |
| U-03 | 承認済み公開計画とdigest | main履歴の承認済み計画と一意なタスク区間 | path逸脱、未承認ref、区間0/2件、本文変更、波・順番変更を試す | 公開計画だけをデータとして読む。LF本文digestは波・順番で変わらず、本文変更は検出 | 正常/異常/境界 |
| U-04 | 状態hashの正規化 | 同じ内容でキー順が異なるJSON | 再帰キー順、仕様の配列順、整数、非整数・NaNを変える | UTF-8/SHA-256のhashが安定。hash自身は除外。不正数値は拒否 | 正常/異常 |
| U-05 | 履歴と先頭位置の一致 | 連続した履歴と先頭位置 | Issue本文のみ変更、イベント改変、途中/末尾欠落、分岐、同seq異hash、先頭不一致を作る | Issue本文は状態に影響しない。履歴破損は書き込み・許可・成功を止める | 正常/異常 |
| U-06 | 連続した末尾だけを回復 | 追記済みイベントが先頭位置より1件以上先 | 再検証して先頭位置を進める | 信頼できる連続末尾だけ回復。不一致を勝手に修復しない | 正常/異常 |
| U-07 | 制御runの照合 | 固定repo・workflow・main履歴・許可イベント | repo/head repo、workflow ID/path、branch/SHA、event、run attempt、取得結果を各1項目変える | 全条件一致だけ採用。偽bot、PR run、別workflow、情報欠落は停止 | 正常/異常 |
| U-08 | request_idの再配送 | 同じIDの処理済み要求 | 同内容/別内容を再送する | 同内容は既存結果だけ。別内容はrequest_conflict。beginの許可は再発行しない | 正常/異常 |
| U-09 | 安定キーと内容競合 | 登録済み又は取り下げ済みtask_key | 波変更、同digest/別digestで登録する | 同作業を増やさず、別本文はcontent_conflict。取り下げキーを自動再利用しない | 正常/異常 |
| U-10 | claimの担当確保 | migration_complete、Issue、計画の開始条件を確認済み | 同callerを再送、別caller、異digest、開始条件不足でclaim | 同callerは同attemptのみ返す。別担当や不足条件では許可しない | 正常/異常 |
| U-11 | beginの初回許可 | 担当が一致するreserved | request/caller/attempt/新activationを照合してbegin | 初回だけlaunching。要求コメントID、制御run/attempt、attempt、activationが結び付く | 正常 |
| U-12 | 古い許可を再利用しない | launching以降又は別プロセス | 同begin再配送、別activation、古い受領結果を渡す | already_begun又は拒否。新プロセスに許可を渡さずspawnしない | 異常 |
| U-13 | spentとメモリのspawnガード | 初回許可を受領済み | spentを排他作成、重複、記録失敗、同実行の二重呼出し | 記録確認後にspawnは1回以下。spentを削除・再利用しない | 正常/異常 |
| U-14 | startedの照合と実モデル | 勝った担当・activationの起動報告 | session空、別担当、未確認Cloud modelを報告 | 確認済みsessionだけrunning。不明はlaunch_unknown。observed_modelを推測しない | 正常/異常/境界 |
| U-15 | 期限と不変条件 | reserved/launching/unknown | 15分の直前・到達・超過、呼出元終了、通信回復を与える | 期限は照合待ちへの変更だけ。担当再割当・新attempt・再起動なし | 境界/異常 |
| U-16 | レビュー対象のOR条件 | 作者ID、branch、共有状態/旧記録の登録 | 各条件を単独成立、全不成立、branch改名、除外の印を試す | どれか1つで対象。保存済み対象はfinalizedまで維持。loginや本文で外せない | 正常/異常 |
| U-17 | Claudeの完了形式 | 固定作者の新規完了JSON | 必須欄、verdict、完全SHA、PR番号、証拠URL、版、引用・旧印を変える | 現在headの有効なmergeだけ候補。短縮SHA、fix/escalate、引用は成功証拠にならない | 正常/異常 |
| U-18 | Claudeの編集はすべて無効 | authorは固定Claude担当 | 本人/他者がhead/verdict/hashを編集、editor/lastEditedAtを欠落・不整合にする | 未編集だけ採用。編集済みは新規投稿が必要。情報取得不能はunknown | 正常/異常 |
| U-19 | Codexの作者と編集者 | IssueComment/Review/ReviewCommentのGraphQL Actor | 未編集、同bot編集、他者編集、非User/Bot、ID欠落を試す | 固定authorと未編集又は同bot編集だけ採用。login一致だけでは採用しない | 正常/異常 |
| U-20 | 完了と開始を区別 | submitted formal review、明示summary、指摘0件 | 未submitted、目の反応、依頼のみ、形式変更を与える | 指摘なし完了は採用。開始・無指摘の推測は完了にならない | 正常/異常/境界 |
| U-21 | 完全SHAの照合 | 現在headとPR commits | formal commit_id、summary短縮値を解決、古いhead、曖昧/取得不能を試す | 一意に解決したPR内の完全SHAだけを比較。古い版は再依頼、曖昧はunknown | 正常/異常 |
| U-22 | Codex証拠集合のhash | 完了と対象指摘の全件 | ID順を変え、本文/編集情報/解決状態/新規/削除/dismissを変える | 順番だけでは不変。意味のある全件と編集情報の変化でhashが変わる | 正常/異常 |
| U-23 | 古い行と行外の指摘 | 現head/古いheadのスレッドと行外指摘 | outdated、未解決、再開、行外確認IDの不足を与える | outdatedは解決でない。全対象スレッドの解決と行外ID全件の確認が必要 | 正常/異常/境界 |
| U-24 | 両レビューの成立 | 現headのCodex完了とClaude merge | Claudeのhash/確認済みIDを現在集合に照合する | 完了、解決、Claude SHA/verdict/hashがすべて成立した場合だけsuccess | 正常/異常 |
| U-25 | 同じSHAのOPEN PR集合 | 同headの対象0/1/2件と対象外PR、異base、Draft | 集合全件を判定する | 対象0件だけ対象外success。対象全件の証拠が必要。Draft対象はin_progress | 正常/異常/境界 |
| U-26 | 公開するデータの制限 | prompt、生ログ、指摘本文、token、security情報の識別文字列 | 要求・状態・Details・CLI公開出力を作る | 公開メタデータと一般的な状態・証拠URLだけ。指摘本文や秘密を含まない | 異常 |
| U-27 | 純粋処理の副作用 | 入力と返却値に可変配列/オブジェクト | 入力を凍結して遷移し、返却集合を変える | 呼出元の状態を破壊せず、後続の遷移やhashへ変更が漏れない | 正常/異常 |
| U-28 | JSONとtask数の制限 | 要求8KiB、差分イベント48KiB、task100件まで | 境界と超過、新規task101件目を与える | 境界までの正しい入力は許可、超過は外部操作なしで停止。全stateを毎回追記せず、履歴を自動削除/移動しない | 正常/異常/境界 |

## 結合試験観点

| # | 観点 | 前提 | 操作 | 期待結果 | 分類 |
| --- | --- | --- | --- | --- | --- |
| I-01 | 一連の受付と完了 | 承認済み計画、移行済み、API/CLIスタブ | register→起票→claim→begin→started→link-pr→両レビュー→finalize | Issue/attempt/session/PRが対応し、実spawnと起票POSTが各1回、最終状態と写しにseqが残る | 正常 |
| I-02 | 起票POSTの応答喪失 | issue_creatingと試行IDを保存済み | POST後応答喪失、全状態Issueに印が0/1/2件 | 自動再POSTなし。1件だけ照合してissue_ready、0件unknown、2件競合 | 異常/境界 |
| I-03 | journal POSTの応答喪失 | writerがイベント追記を開始 | 追記成功/不明で応答を失い、要求ID・seq/hashを読み直す | 照合前に再追記や外部操作なし。確認不能は停止、重複/分岐を成功にしない | 異常 |
| I-04 | 履歴と先頭更新の途中停止 | 正常なwriter | 追記前後、先頭更新前後、読み直し中でクラッシュ | 両方の確認前に起票/許可なし。次writerは連続末尾だけ回復。外部作成物を削除しない | 異常 |
| I-05 | 要求が配送から落ちても残る | 100件を超える要求、再配送100件 | reconcile/scheduleでID順にdrain | 1job最大20件、残りは未処理。queue:maxを受付保証にせず、requestを消さない | 正常/境界 |
| I-06 | 全ページと取得上限 | 100件のページ境界を跨ぐfixture | OPEN PR、管理コメント、review、thread、thread内comment、runを取得 | 101件目以降も検証。途中失敗、上限到達/超過はunknown。部分集合でsuccessなし | 正常/異常/境界 |
| I-07 | 読取リトライとAPI予算 | 10秒timeout、Retry-After、応答異常 | 読取失敗、200/201回目、job5分・待機2分到達 | 最大3回、1/2/4秒上限、Retry-After最大30秒。POST不明は再送なし。予算後も要求を残す | 異常/境界 |
| I-08 | 同じ要求と異なる担当の並行配送 | 同request/task/caller又は異caller/activation | barrierでregister/claim/beginを並行実行 | 単一writerが直列化。同requestは内容を照合し、Issue/attemptは1つ、spawnは1回以下 | 正常/異常 |
| I-09 | begin送信・受領結果の喪失 | reservedから1回送信するラッパー | 送信応答喪失、初回結果喪失、再配送結果、別run/attemptの結果を渡す | 再送結果を許可にしない。受領IDなど全対応が合う初回結果だけ消費 | 異常 |
| I-10 | spentの前後とspawn後のクラッシュ | 初回許可受領済み | spent前の記録失敗、spent作成直後、spawn直後、started保存前に停止 | spent失敗はspawnなし。作成後の未起動もunknown。再実行/別activationにspawnなし | 異常 |
| I-11 | 起動未知の照合 | issue_unknown/launch_unknown、期限切れ | session/processを読取照合し、未確認/確認済み結果を返す | 確認済み対応だけ進む。時間経過・通信復旧・ラッパー終了で再起動しない | 正常/異常 |
| I-12 | ローカルとCloudの起動設定 | runner/model明示、private prompt file、CLIスタブ | local/cloud、引数不足、実model不明、セッション情報不明を返す | 指定値を運ぶ。Cloud実値不明はunknown。raw promptと生ログは手元に留める | 正常/異常 |
| I-13 | GitHub/MCPへ接続不能 | gh無し/未認証/失敗、接続済みMCPのスタブ | request、status、launch、review-refreshを呼ぶ | 共通JSONだけで受付。状態を照合不能なら起票/起動/成功なし。古い写しは未確認表示だけ | 正常/異常 |
| I-14 | 判定中の集合・証拠の変化 | 過去success、判定1回目は成立 | 書込直前にPR追加/close/reopen/head移動、証拠編集/削除/dismiss、API失敗 | 先にin_progressへ戻す。全ページと証拠を再取得し、変化/取得失敗でsuccessを書かない | 異常 |
| I-15 | SHAごとのcheckを共有 | 同SHAの対象/対象外/別baseのOPEN PR | 並行refresh、全件成立、片方不足、Draftを試す | SHAごとに1つの明示check IDを更新。external_id別の成功や対象外PRで迂回しない | 正常/異常 |
| I-16 | headと状態変化を反映 | 保存済みPR番号と前回head | push、close/reopen、対象PR追加/削除、定期refresh | 旧SHAと新SHAの集合を再判定。古いsuccessを新headへ引き継がない | 正常/異常 |
| I-17 | CIとレビューの独立 | CIのmerge SHA≠PR head、agent-review pending | 既存CI成功/失敗、明示check作成/更新失敗を与える | headに明示check。agent-reviewをCI待機/集計から除外して自己依存なし。書込不能を成功と報告しない | 正常/異常 |
| I-18 | 特権処理の実行元と権限 | controller/listenerのworkflow定義 | 全event、dispatch非main、PR refのコード/添付/ref指定を検査 | controllerは保護mainの制御コードだけ。PRコード・npm/build・shell入力を実行せず、listenerはcheckout/書込なし | 正常/異常 |
| I-19 | 通知artifactの検証 | 許可listener/ci/e2e run | repo/workflow偽造、JSON欠落、空PR、8KiB超、zip任意pathを渡す | 通知をデータとして所属PRを再取得。未知は停止。任意展開や通知の判定結果採用なし | 正常/異常/境界 |
| I-20 | 通知の再帰と自動job check | controller自身のrun、bot表示、check更新 | workflow定義とdispatch出力を調べる | 自身の完了で再起動なし。表示を要求にしない。自動job名はagent-reviewでなく、必須判定は明示Checks APIだけ | 異常 |
| I-21 | 既存CLI・status・wait・hookの接続 | 旧YAML、共有seq、複数PR候補 | request/import/status、旧CLI、待機、SessionStart/PostToolUseを呼ぶ | 共有状態を優先。曖昧候補を最小番号で選ばない。完全SHAとCodex再依頼を示し、hookは例外時もexit 0 | 正常/異常 |
| I-22 | 移行前とimportの権限 | migration_complete=false、進行中のIssue/PR/session | register/claim、許可/別作者のimport、未確認対応を試す | 新規登録/起動を止める。固定担当者の確認済み対応だけimport。未登録を未着手と推測しない | 正常/異常 |
| I-23 | Actions作者の先頭コメントを初期化する | 管理Issueとcontroller IDだけを固定済み | 固定担当者のmain dispatch、既存0/1/2件、POST応答喪失、初回journal後の再読込を試す | 初回コメントと更新後の作者がActions。既存1件は再利用、複数/結果不明は再POSTなし。通常受付はID設定後だけ | 正常/異常/境界 |

## 特性観点

- 権限: 固定数値IDと編集者を別に照合する。管理コメントの本文と作者・編集情報をGraphQLの同じ応答から読み、REST時刻が同値になる同秒編集も拒む。単一writerと保護mainの実行元を検証する（U-07、U-18〜U-19、I-18〜I-20、I-22）。
- データ整合性: seq/hash/先頭位置、taskとdigest、attemptとactivation、PRごとの証拠を照合する（U-04〜U-14、U-22〜U-25）。仕様上の集合はID順の全件を`deepEqual`等で固定する。
- 冪等性: request、task、caller、activationを別々に扱い、外部POST/spawnの呼出回数と引数も検証する（U-08〜U-13、I-02〜I-10）。外部セッションのexactly-onceは保証の対象外。
- 障害系: 通信timeout、POST応答喪失、保存の部分失敗、ページ途中の失敗、予算・時間上限、check更新不能を検証する。写しへの縮退は表示だけ（I-02〜I-07、I-09〜I-17）。
- フロントエンド: 対象外。アプリ画面を変えない。CLIと公開Detailsの未処理/unknown/再確認表示はU-26、I-21で確かめる。
- 防御性: Entity/VOは対象外。共有状態の不変条件・入力隔離・副作用回数をU-05、U-10〜U-15、U-27、I-08〜I-10で確認する。Domain固有のfactor/multiplierやupdatedAtは追加しない。

## メソッド網羅チェック表

新設モジュールのexportと、返すクライアントの操作を次表に示す。エラークラスは独自メソッドを持たず、エラーコードと公開メッセージを境界試験で確かめる。

| モジュール | public API | 対応する試験観点 |
| --- | --- | --- |
| delegation-shared | canonicalJson、hashJson、taskDigest、extractPlanTask | U-01〜U-04、U-27〜U-28 |
| delegation-shared | validateRequest、parseRequestComment、formatRequestComment、newRequestId、DelegationError | U-01〜U-02、U-08、U-26〜U-28 |
| delegation-shared | emptyState、applyChanges、createJournalEvent、verifyJournal、formatAnchor | U-04〜U-06、U-27〜U-28、I-03〜I-04 |
| delegation-shared | reduceRequest（register/claim/begin/started/link-pr/import/reconcile/review-refresh） | U-08〜U-15、I-01〜I-12、I-22 |
| delegation-shared | verifyControlRun、verifyMainCommit、readIssueComments、uneditedComment、readSnapshot、submitRequest、waitForResult | U-03〜U-08、U-28、I-03〜I-07、I-09、I-13〜I-16 |
| delegation-shared | REQUEST_MARKER、EVENT_MARKER、ANCHOR_MARKER、TASK_MARKER、ZERO_HASH | U-02〜U-06、I-02〜I-04、I-23 |
| delegation-github | GitHubError、createGitHubClient、返すrest/graphql/paginate/downloadArtifactとcalls getter | U-07、I-02〜I-07、I-13、I-19 |
| delegation-launch | parseLaunchArgs、consumeBeginReceipt、reserveSpent、buildDevinArgs、launchDelegation、runLaunchCli | U-11〜U-15、I-08〜I-13 |
| agent-review | collectReviewSnapshot、evaluateSha、createClaudeCompletion。判定payloadをcontrollerへ返す | U-16〜U-27、I-14〜I-17 |
| delegation-control | persistEvent、verifyPlan、findCreatedIssue、refreshSha、runController | U-03〜U-08、I-01〜I-08、I-14〜I-22 |
| delegation-control | decodeNotificationZip、initializeAnchor | I-18〜I-20、I-23 |

次表は走査した既存変更対象の全export関数・クラスと公開定数。クラスは`UsageError`だけで独自メソッドはなく、staticファクトリ・ゲッターはない。Rは下の回帰表を指す。

| 既存モジュール | public API | 対応する試験観点 |
| --- | --- | --- |
| delegation | toYaml、parseYaml | R-01、I-21 |
| delegation | newRecord、newSelfRecord、recordKey、targetArg、runnerFromAuthor | R-01、I-12、I-21〜I-22。runnerFromAuthorは旧履歴の表示用に限る |
| delegation | parseFinding、addReview、roundsOf、parentKeys | R-01、U-26、I-21 |
| delegation | firstCiCommit、buildGhSection | R-01、I-17 |
| delegation | summarize、formatSummary | R-01、I-12、I-17、I-21 |
| delegation | readRecord、writeRecord、readAllRecords、defaultMirrorDir | R-01、R-06、I-13、I-21 |
| delegation | preferRecord、mergeRecords、readKnownRecords、readRecordMerged | R-01、I-21。review数の選択は旧記録同士に限る |
| delegation | parseOptions、runCli、UsageError | R-01、I-21〜I-22 |
| delegation | readSharedSnapshot、cacheSharedSnapshot、runSharedRequestCli | I-01、I-13、I-21〜I-22。写しから旧reviewを続け、再取得後も履歴を保持する |
| delegation | DEFAULT_DIR、MODELS、RUNNERS、SEVERITIES、VERDICTS、PRIVATE_SUMMARY、ORIGINS | R-01、U-26、I-12。列挙値を集合全体で固定 |
| delegation-status | isDone、prNumberOf、nextAction、offlineAction、buildStatus | R-02、I-13、I-21 |
| delegation-status | findPromotions、prunableMirrorKeys、oneLine、formatStatus | R-02、I-21 |
| delegation-status | collectStatus、runStatusCli、CANDIDATES_DIR、WAIT_PR_LIMIT_HOURS、MIRROR_KEEP_DAYS | R-02、I-13、I-21 |
| delegation-status | statusFromSnapshot、collectSharedStatus | R-02、I-13〜I-17、I-21 |
| wait-for-pr | findLinkedPr、issueCreatedAt、listPrs | R-03、I-06、I-13、I-21 |
| wait-for-pr | registeredPrForIssue | R-03、I-21 |
| wait-for-pr-update | checksComplete、ciConclusion、countNewCommits、detectUpdate、parseArgs | R-04、I-17、I-21 |
| wait-for-devin-pr | findUnlinkedDevinPrs、knownFromRecords、hasReviewMarker、filterUnreviewed | R-05、I-21。旧印だけで新チェックを成功にしない |
| wait-for-devin-pr | prComments、toOutputLine、listOpenDevinPrs、parseArgs、DEVIN_BRANCH_PREFIX、REVIEW_MARKER | R-05、I-06、I-13、I-21 |
| hooks/delegation-status | hookOutput | R-02、I-21 |
| hooks/suggest-pr-watch | createdIssues、buildContext | R-07、I-21〜I-22 |

## 回帰試験範囲

| # | 既存試験 | 維持/更新する振る舞い |
| --- | --- | --- |
| R-01 | delegation.test.mjs | 旧YAML往復、Issue番号/pr-N、reviews、follow_up_of、集計、security非公開、旧CLI終了コード。旧短縮SHAは履歴として残し、新チェックの証拠にしない |
| R-02 | delegation-status.test.mjs | 完了、再レビュー、修正待ち、昇格候補、30日境界、未認証表示、hook。共有seq/取得日時を優先し、両レビュー不足をマージ可と表示しない |
| R-03 | wait-for-pr.test.mjs | 正しいIssue対応と作成時刻境界。複数候補を最小番号で選ぶ旧試験は、曖昧として止める試験へ更新 |
| R-04 | wait-for-pr-update.test.mjs | head更新、CI結論、0件猶予、閉鎖、終了コード。agent-reviewを除いて自己依存を防ぐ。旧SHAのprefixを完了証拠へ流用しない |
| R-05 | wait-for-devin-pr.test.mjs | IssueなしPR、記録済みPR、since境界、JSON、取得失敗。旧印の存在だけで現在headのレビューを完了扱いしない |
| R-06 | harness-paths.test.mjs、harness-state.test.mjs、devin-watch.test.mjs、devin-stall-watch.test.mjs | 名前空間と状態ディレクトリ、既存監視/生ログ表示。対象コードを変えない場合は既存試験だけを回す |
| R-07 | suggest-pr-watch.test.mjs | URL重複と壊れた入力のexit 0。直接起票後のinit/起動誘導は共通受付・照合の案内へ更新 |

`.claude/tests/*.test.mjs`全件を回す。既存quality・build・api-dbの必須設定とE2Eのpaths条件は維持し、workflow試験でも差分を確認する。

## 試験データ

- repo/作者は設計の固定数値IDをfixtureに置く。loginを同じにしてIDを違える例、同authorでeditorだけ違える例を用意する。
- 公開計画、要求UUID、40桁SHA2個、同prefixのコミット2個、64桁digest、task/caller/attempt/activationを明示する。秘密や実トークンをfixtureに使わない。
- 0/1/2件のタスク区間・Issue印・同SHAの対象PR、対象/対象外/異base/Draft、全件成立と1件不足を用意し、期待ID集合を固定する。
- ページは99/100/101件。OPEN PR・管理コメント・formal review・スレッドは上限1,000件到達と1,001件、スレッド内は合計5,000件到達/超過を作る。task100/101件、要求8KiB/超過、状態48KiB/超過、API200/201回を作る。
- edited/null/missingのGraphQL証拠、古い未解決/outdatedスレッド、行外指摘、submitted/未submitted/反応だけ/指摘なし完了を用意する。
- in-memory GitHubはPOST呼出回数・保存順・読取ページ・公開payloadを記録する。barrierと故障注入で並行配送と各保存境界を固定し、実時計の長い待機を使わない。
- spentは試験専用の一時ディレクトリ。再実行時は同じspentを残して検証し、試験後だけ清掃する。spawnスタブは起動回数とCLI引数を記録し、外部通信をしない。

## 完了条件

実装PRの合格条件と、実環境への導入条件を分ける。未実施の実機確認を、スタブ試験の成功で満たしたとは扱わない。

- 単体・結合・回帰の全観点を実装する。呼出回数、保存順、全ID集合、公開payloadを検証し、全ハーネス試験が通る。
- 実装後に新設exportを走査し、網羅表を実在するAPI名へ更新する。正常・異常・境界、操作8種、要件の全受け入れ条件に漏れがないことを確認する。
- 要件の並行起票/起動はI-08〜I-10、要求保持/破損/上限はI-03〜I-07、同SHA全件はU-25/I-14〜I-16、古い/偽/編集済み証拠はU-17〜U-24、CI独立はI-17/I-20に対応する。
- 実装計画と試験ファイル・対象範囲を照合する。アプリ試験、実Devin起動、休眠Gate B・改善3Agentの必須化は対象外。
- 公開出力へ秘密や指摘本文が出ず、unknownから自動起票/再起動/レビュー成功へ進まないことを確認する。

| 実機の導入確認 | 確認すること | 現在の状態 |
| --- | --- | --- |
| 明示Checks APIと必須設定 | GITHUB_TOKENで作ったcheckがPR headに関連付き、success/不足failure/head更新でマージを止める。自動job checkと区別し、同SHA全件の判定も確認 | 未実施。成立確認後だけagent-reviewを必須化 |
| controllerの各イベント | issue_comment、main限定dispatch、schedule、workflow_runのmain branch/SHA、許可workflow、listener通知、権限と非再帰を確認 | 未実施。writer以外に管理Issue更新権限を与えないことが導入条件 |
| Codexの確認PR | ユーザーの明示依頼、指摘なし完了、修正push後の再依頼、古いhead、不足/両レビュー、編集者情報を確認 | 未実施。All PRs/push設定とbot自動依頼を保証しない |
| 既存CLI/Cloudの照合 | 実在するsession ID/URL形式、実modelと内部起動POST再送設定を読取確認 | 未実施。テスト用Devinは起動しない。不明はunknown |
| 進行中タスクの移行 | 計画/Issue/PR/Local・Cloud sessionを照合してimportし、未確認をunknownに残す | 未実施。migration_complete前は新規登録/起動を止める |
| 接続と上限・性能 | 実在MCPの受付/照合可否、管理Issue初期化、workflow ID、7タスク20〜60秒目安、ページ上限付近と二重配送100件を確認 | 未実施。処理限界を受付保証や動作保証にしない |

実機確認が失敗又はunknownなら、レビュー必須化と移行完了の宣言をしない。設定変更とPRマージはユーザーが判断する。

## 実装時の検証結果（2026-10-10）

Node 22.23.3で`node --test .claude/tests/*.test.mjs`を実行し、351件すべてPASS（失敗・取消・省略0、終了コード0）。途中停止、同じ要求の再送、同秒編集、全頁・API予算、起票と起動の回数、古いレビューと編集者の照合、YAMLへの写しを含む。構文確認、相対リンク、論点の記録の形と差分の空白検査もPASS。

管理Issue・先頭コメントIDは未設定、migration_completeとcli_launch_verifiedはfalseのまま。statusのJSON表示と停止設定を確認した。アプリ、依存パッケージと既存CI定義は変更していないため、ローカルのアプリlint／type-check／test／buildは省略した。上表の実機確認は未実施で、試験用Devinも起動していない。
