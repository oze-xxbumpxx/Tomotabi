# 設計書: devin-delegation-loop

- ステータス: confirmed（2026-09-26 ユーザー承認。未決事項 1〜8 はすべて推奨どおり）
- レベル: L2 / ユーザー承認: 必要（ハーネス `.claude/`・`AGENTS.md`・`.agents/` の変更）
- 関連: `.claude/skills/review-devin-pr/SKILL.md` / `.claude/scripts/wait-for-pr.mjs` / `docs/claude-code/improvement-cycle.md` / `docs/claude-code/memory-policy.md` / `docs/devin-setup.md`

## 背景

「Issue → Devin が実装 → Claude Code がレビュー → ユーザーがマージ」のループは、PR ができるまでは自動（PR #38）だが、その先に 3 つの穴がある。

1. **指摘が直しに戻らない。** `review-devin-pr` は PR コメントの前にユーザーの了承を取る。Devin の PR には監視が付いており、write 権限を持つユーザーのコメントに自動で対応する（本文に `(aside)` を含むコメントは対象外。PR #35・#39 の Devin の自動コメントで確認）。Claude が `gh pr comment` すれば Devin は直すが（#35 ではコメントの 19 分後に修正コミットと返信があった）、直ったあとの再レビューを待つ仕組みが無い。`wait-for-pr.mjs` は PR の作成しか待たない。
2. **学びがハーネスに戻らない。** reflection / manager / evaluator の改善サイクルは休眠中。backlog と candidates は空。evals（`.claude/evals/`）は配布元 Cookpit のドメイン向けで、Tomotabi の回帰評価には使えない。
3. **成果を測っていない。** 手戻り回数・指摘数・CI 初回成功・Issue から PR/マージまでの時間・Devin のモデル（SWE-2 medium / high / max）ごとの成功率が残っていない。

これまでの指摘の例（今回の記録の初期データにする）:

| PR | Issue | 指摘 | 分類（案） |
| --- | --- | --- | --- |
| #35 | #31 | テストが素の HTTP サーバーで、Nest の例外経路を通っていなかった。例外の message（DB URL）がログに出た | `test-path-mismatch` / `security`（秘密のログ漏れ） |
| #39 | #37 | テストと本番で `bodyParser` の設定が違う | `test-path-mismatch` |
| #39 | #37 | sign-in の 400/415 が `{code,message}` 形式でない | `error-shape` |
| #39 | #37 | `/api/auth/*` が 1 要求 1 行のログに出ない | `logging-gap` |
| #33 | #32 | PR 本文に `Closes #N` が無い | `pr-metadata` |

`test-path-mismatch`（テストが本番と違う組み立てで動く）は、すでに 2 件ある。

## 目的

1. レビュー → 修正 → 再レビューを、ユーザーを介さず上限付きで回す。ユーザーが止まるのは「マージ」「セキュリティ指摘」「上限到達・判断が要る指摘」だけにする。
2. 委譲ごとの記録から、同じ種類の指摘の繰り返しを数え、閾値に達したらハーネス（Issue の書き方・`devin-workflow`・レビュー手順）の改善案を出す。
3. モデル別・Issue 別に、手戻りと所要時間を数字で見られるようにする。

## 要件

- R-1: 自動投稿してよい指摘と、ユーザーを通す指摘を分類で決める。**セキュリティ指摘は自動投稿しない。**
- R-2: 指摘を投稿したら、PR の更新（新しいコミット → CI 完了）を待つ。ポーリングは Claude のターンでは行わず、バックグラウンドのスクリプトに任せる。
- R-3: 自動の再レビューに上限を設ける。上限に達したらユーザーに渡す。
- R-4: 委譲ごとに 1 ファイルの記録を残す（並行 PR で衝突しない）。gh から取れる値は手で書かない。
- R-5: 記録から、分類ごとの件数・モデル別の成績・所要時間を集計できる。閾値を超えた分類を「昇格候補」として示す。
- R-6: 既存の減速ルール（同種 3 件で昇格・早期昇格の禁止・例外は確証あり修正極小のみ）と矛盾しない。
- R-7: 新しいスクリプトには `.claude/tests/` に `node --test` のテストを付ける。

## 対象範囲

- レビューのループ: 指摘の分類、自動投稿、PR 更新の待機、再レビュー、上限と引き渡し。
- 委譲の記録: `docs/claude-code/improvements/delegations/<issue>.yml` と、その作成・集計スクリプト。
- 学びの還流: 集計から昇格候補を出し、既存の `candidates/` と backlog の形式で起票する手順。
- 初期データ: #33・#35・#39・#42 を記録として起こす（分かる範囲。モデルが不明なものは `unknown`）。

## 対象外

- Issue #43・#44 のレビュー（元のセッションが担当）。
- reflection / manager / evaluator の再稼働と evals の Tomotabi 用整備（別途。本設計の記録形式は将来そちらに渡せる形にする）。
- Devin 側の設定変更（監視の無効化など）。Devin の PR 監視はそのまま使う。
- sprint-review への集計の組み込み（最初は `summary` を手で呼ぶ。定着したら次段で入れる）。
- Devin への指示をプライベートに渡す仕組みの自動化（セキュリティ指摘の経路は手動の手順だけ決める）。

## 現状構成

```
gh issue create ─(hook: suggest-pr-watch)→ wait-for-pr.mjs <issue>  [background]
                                              │ exit 0: PR 番号
                                              ▼
                                   review-devin-pr: レビュー
                                              │
                                   文面をユーザーに見せる → 了承 → gh pr comment
                                              │
                                   （Devin が直す。ここで止まる。再レビューは人が思い出したとき）
```

## 変更後構成

```
devin --cloud --model swe-2-<effort> -p … / gh issue create
   │  delegation.mjs init <issue> --model swe-2-<effort>   ← 委譲の記録を作る
   ▼
wait-for-pr.mjs <issue>  [background]            （既存・変更なし）
   ▼
review-devin-pr: round 0 のレビュー → 指摘を分類
   ├─ security を含む ───────→ 投稿しない。ユーザーに渡す（下記「セキュリティ」）
   ├─ decision を含む ───────→ 投稿しない。ユーザーに判断を仰ぐ
   ├─ must を含む ───────────→ 自動投稿（must ＋ 同じ回の nit）
   │                             wait-for-pr-update.mjs <pr> --since <投稿時刻>  [background]
   │                               exit 0: 更新あり → 差分だけ再レビュー（round+1）
   │                               exit 3: 時間切れ → ユーザーに伝える
   │                               exit 4: PR が閉じた / マージされた → 記録して終わる
   │                             round が上限（2）を超えそう → ユーザーに渡す
   └─ must なし ─────────────→ 「マージ可」（nit は後続 Issue の案として添える）→ ユーザーに通知
   ▼
ユーザーがマージ / クローズ
   ▼
delegation.mjs finalize <issue>   ← gh から時刻・CI・コミット数を取り、記録を閉じる
   ▼
delegation.mjs summary            ← 分類ごとの件数・モデル別の成績・昇格候補
```

### 指摘の分類（severity）

| 分類 | 意味 | 扱い |
| --- | --- | --- |
| `must` | 直さないとマージできない（設計書・試験計画との食い違い、テストが経路を通っていない、規約違反、`Closes` 漏れ） | **自動投稿**して Devin に直させる |
| `nit` | 直した方がよいが、マージを止めない | `must` があれば同じコメントに入れる（同じ回で直させる）。`must` が無ければ投稿せず、後続 Issue の案としてユーザーに渡す |
| `security` | 迂回・秘密の漏れ・権限の不備など、公開すると悪用の手がかりになるもの | **投稿しない。** ユーザーに渡す |
| `decision` | 設計・範囲の判断が要る（設計書に無い仕様、範囲外の変更の要否） | 投稿しない。ユーザーに判断を仰ぐ |

加えて、指摘ごとに `category`（kebab-case の短い名前）を付ける。集計と昇格判断はこの `category` で数える。最初の語彙は `delegations/README.md` に置き、増やすときはそこに足す（既存に合うものがあれば新しく作らない）。初期語彙: `test-path-mismatch` / `error-shape` / `logging-gap` / `pr-metadata` / `scope-creep` / `spec-mismatch` / `missing-test` / `coding-standard` / `security`。

### 自動投稿のコメント

- 1 回のレビューで 1 コメント。先頭に機械可読の印 `<!-- claude-review round=<n> -->` を入れる（再レビューで前回のコメントと時刻を特定するため）。
- 本文は「何が起きるか → 期待 → 直し方の案」を指摘ごとに書く（#35 の形）。`(aside)` は入れない（Devin が対応しなくなるため）。
- 範囲外の気づき・後続の Issue 案は、Devin に対応させたくないので、別のコメントにして `(aside)` を付けるか、投稿せずにユーザーに渡す（既定は後者）。

### 再レビューの上限

- round 0 が初回。自動の再レビューは **round 2 まで**（指摘の投稿は最大 2 回）。
- round 2 でも `must` が残る、または前回と同じ指摘が直っていないときは、自動投稿をやめてユーザーに渡す。報告にはモデルを上げる（例: medium → high）か、Claude が直すか、Issue を分けるかの案を付ける。
- CI の失敗は Devin の監視が自分で直すので、指摘の round には数えない。`wait-for-pr-update.mjs` が CI の完了まで待つ。

## データフロー

### 委譲の記録（`docs/claude-code/improvements/delegations/<issue>.yml`）

手で書く欄と、`finalize` が gh から埋める欄を分ける。

```yaml
issue: 43
title: '#39 の軽微な指摘 3 点'
agent: devin
model: swe-2-medium        # init で必須。swe-2-medium | swe-2-high | swe-2-max | unknown
change_level: 1
delegated_at: 2026-09-26T05:25:28Z   # init 時に Issue の createdAt を入れる
reviews:                   # review-devin-pr が round ごとに追記する
  - round: 0
    reviewed_sha: abc1234
    verdict: fix           # merge | fix | escalate
    posted: true           # 自動投稿したか
    findings:
      - { severity: must, category: test-path-mismatch, summary: 'テストのアプリ生成が bodyParser: false でない' }
      - { severity: nit, category: logging-gap, summary: '…' }
escalations: 0             # ユーザーに渡した回数
outcome: null              # finalize で埋める: merged | closed | open
gh:                        # finalize が gh から埋める。手で書かない
  pr: 45
  pr_created_at: …
  merged_at: …
  commits: 4
  ci_first_pass: true      # PR の最初のコミットで必須チェックがすべて成功したか
  closes_linked: true      # closingIssuesReferences に Issue があるか
```

- セキュリティ指摘は `summary` に再現手順・迂回の方法を書かない。`summary: '(非公開)'` とし、詳細はローカルのメモかユーザーとのやり取りに留める。記録は公開リポジトリに入るため。
- 記録は **マージ後（またはクローズ後）に** `finalize` してから、その日の締め（`close-session`）の PR にまとめて入れる。Devin の作業ブランチには commit しない（修正中のブランチに同時に書かない規則のため）。ファイルは委譲ごとに分かれるので、並行 PR でも衝突しない。

### 集計（`delegation.mjs summary`）

```
委譲 6 件（merged 5 / open 1）
モデル別     件数  一発合格  平均 round  CI 初回成功  Issue→PR 中央値  PR→マージ 中央値
swe-2-medium   2     1/2        0.5          2/2           41m              5h
swe-2-max      1     0/1        1.0          1/1           …                …
unknown        3     …
分類別（異なる Issue の数）
test-path-mismatch   2   ← あと 1 件で昇格候補
security             1
昇格候補: なし
```

- 「一発合格」= round 0 の判定が `merge`。「成功率」はこの一発合格率と、マージ率（merged / 完了）の 2 つで見る。
- 分類の件数は「その分類が出た Issue の数」で数える（同じ PR で 3 回出ても 1 件）。1 つの委譲の中の繰り返しは round で表れるため。

## API 設計

対象外（アプリの API は変えない）。スクリプトの CLI は次のとおり。

| コマンド | 役割 | 終了コード |
| --- | --- | --- |
| `node .claude/scripts/wait-for-pr-update.mjs <pr> --since <ISO> [--interval 秒] [--timeout 秒]` | `--since` より後に head のコミットが変わり、そのコミットの CI が完了するまで待つ。出力の JSON 行: `{pr, headSha, ciConclusion, newCommits}` | 0 更新あり / 2 引数誤り / 3 時間切れ（既定 4 時間） / 4 PR が閉じた・マージされた |
| `node .claude/scripts/delegation.mjs init <issue> --model <m> [--level <0-3>]` | 記録を作る。既にあれば上書きしない（エラー） | 0 / 2 |
| `node .claude/scripts/delegation.mjs review <issue> --round <n> --sha <sha> --verdict <v> [--posted] --finding '<severity>:<category>:<summary>' …` | round の結果を追記する（Claude が YAML を手で編集して崩すのを避ける） | 0 / 2 |
| `node .claude/scripts/delegation.mjs finalize <issue>` | gh から PR・時刻・CI 初回・コミット数・`Closes` の紐づけを取り、`gh:` と `outcome` を埋める | 0 / 2 / 3（PR が見つからない） |
| `node .claude/scripts/delegation.mjs summary [--dir <path>] [--threshold 3]` | 集計と昇格候補の表示。gh を呼ばない（記録だけを読む） | 0 |

- 判定の中身（更新の検知・CI の完了判定・集計・昇格判定）は純粋関数に閉じ込めてテストで固定する。gh の呼び出しは薄い層に分ける（`wait-for-pr.mjs` と同じ方針）。
- 「CI の完了」は `statusCheckRollup` の全項目が `COMPLETED`（CheckRun）または `SUCCESS/FAILURE/ERROR`（StatusContext）になったとき。失敗で完了しても exit 0 で返し、`ciConclusion: failure` を出す（Devin が CI を直している途中かどうかは Claude が判断して、もう一度待つ）。
- YAML は依存を増やさないため、スクリプトが読み書きする範囲の小さな形（上の固定のキー）に限る。書き出しは自前、読み込みも自前の最小パーサにする。代わりに JSON（`<issue>.json`）にする案は「未決事項」に置く。

## DB 設計

対象外。

## フロントエンド設計

対象外。

## バックエンド設計

対象外（アプリのコードは変えない）。変更するハーネスのファイル:

| ファイル | 変更 |
| --- | --- |
| `.claude/scripts/wait-for-pr-update.mjs` | 新規 |
| `.claude/scripts/delegation.mjs` | 新規（init / review / finalize / summary） |
| `.claude/tests/wait-for-pr-update.test.mjs`・`delegation.test.mjs` | 新規 |
| `.claude/skills/review-devin-pr/SKILL.md` | 分類・自動投稿・再レビューのループ・上限・セキュリティの経路・記録の手順に書き換える。「投稿前にユーザーの了承」を「`must` / `nit` は自動、`security` / `decision` はユーザー」に変える |
| `.claude/skills/close-session/SKILL.md` | 締めで `finalize` を実行し、記録をコミットに含める |
| `.claude/hooks/suggest-pr-watch.mjs` | 促す文に `delegation.mjs init` を足す（起動はしない）。テストを更新 |
| `docs/claude-code/improvements/delegations/README.md` | 記録の形式・分類の語彙・昇格の閾値 |
| `docs/claude-code/improvements/delegations/<issue>.yml` | 初期データ（#31→#35、#32→#33、#37→#39、#41→#42。#30→#34 も分かる範囲で） |
| `docs/claude-code/improvement-cycle.md` | 「委譲ループの軽量サイクル」の節を足し、減速ルールとの関係を書く |
| `AGENTS.md` | Devin の節に 1〜2 行: 「Claude Code のレビューは `must` を PR に自動投稿し、Devin の修正を再レビューする（上限 2 回）。セキュリティ指摘は投稿しない」 |
| `.agents/skills/devin-workflow/SKILL.md` | 変更しない（昇格候補が出てから変える。下記「学びの還流」） |

### 学びの還流（重い既存の仕組み と 軽い仕組み の比較）

| 観点 | A: 既存の改善サイクルを起こす（reflection → manager → evaluator） | B: 委譲に合わせた軽い仕組み（記録 → 集計 → 候補 → ハーネス PR）【推奨】 |
| --- | --- | --- |
| 入力 | タスクごとの振り返り（reflection-agent が書く文章） | 委譲ごとの記録（分類付きの指摘。レビューの副産物として必ず残る） |
| 数え方 | manager（Opus）が文章を読んで同種を判断 | `category` の件数を機械的に数える |
| 評価 | evaluator が evals で before/after。**Tomotabi 用の evals が無く、今は成立しない** | 昇格後の委譲で、その分類の件数が減ったかを `summary` で見る（事後評価） |
| コスト | 1 回ごとに Agent 3 つ。メタ作業の再増殖の懸念（IMP-2026-030） | スクリプト 1 回。追加の Agent 呼び出しなし |
| 減速ルール | そのまま | 同じ閾値（3 件）を機械で守る。候補・提案の形式は既存（`candidates/`・backlog・`proposals/`）を使う |
| 将来 | — | 委譲が増え evals を整えたら、記録を reflection の入力にして A に合流できる |

推奨は B。理由: 指摘の分類はレビューの時点で Claude が既に持っている情報で、振り返りの Agent に読み直させる必要がない。evaluator が使えない今、A は形だけになる。

B の手順:

1. `summary` が、異なる Issue で **3 件**に達した `category` を「昇格候補」として出す。
2. Claude は、その日の締めか次の委譲の前に、`candidates/delegation-<category>.md`（既存テンプレート）と backlog の 1 行を起票する。出典に Issue / PR 番号を並べる。
3. 変更先は分類で決まる。Devin の実装の癖 → `devin-workflow` のチェック項目、Issue の書き方の不足 → Issue 本文の定型（`review-devin-pr` の「委譲」節に置く）、Claude のレビューの見落とし → `review-devin-pr` のチェック項目。
4. 変更はハーネスの PR としてユーザーがレビュー・マージする（既存の承認境界どおり）。マージしたら backlog を `accepted`、proposal を `accepted/` へ。
5. 事後評価: 昇格後の 3 委譲で、その `category` が 0 件ならよし。再発したら proposal に追記して見直す。

減速ルールとの整合:

- 閾値は既存と同じ 3。**早期昇格はしない**。例外は既存の「確証あり・修正極小」だけ。
- 1 回の委譲の中の繰り返しは数に入れない（上記「分類の件数」）。1 つの PR の癖への過剰適応を避けるため。
- `security` だけは 2 件で昇格候補にする案を「未決事項」に置く（memory-policy の「重大な試験不具合」に当たると読む）。

## エラー処理

外部 I/O は gh（GitHub API）だけ。

- (a) リトライ: gh の一時的な失敗はその周期を捨てて次の周期で再試行する（`wait-for-pr.mjs` と同じ）。回数の上限は設けず、全体の時間切れ（既定 4 時間）で止める。`finalize` は 1 回だけ実行し、失敗したら exit 3 で返し、Claude が後でやり直す。
- (b) タイムアウト: `execFileSync` に 30 秒のタイムアウトを付ける（無いと gh が固まったときに待機全体が止まる）。
- (c) 冪等性: `init` は既存の記録があればエラーにする（上書きで round の記録を消さない）。`review` は同じ round の再追記をエラーにする。`finalize` は `gh:` と `outcome` を毎回上書きするので何度実行してもよい。
- (d) 部分失敗: 記録は 1 ファイルを一時ファイルに書いてから rename する。
- (e) フォールバック: gh が使えないときは待機が時間切れになり、Claude がユーザーに伝える。記録が作れなくてもレビューは続ける（記録は計測のためで、ループを止めない）。

## ログと監視

- 待機スクリプトは、開始・見つかった・時間切れ・gh の失敗を標準出力/標準エラーに 1 行ずつ出す（既存と同じ）。
- 委譲の結果の監視は `summary` の出力。定着したら sprint-review に入れる（対象外）。

## セキュリティ

- **公開リポジトリへの投稿**: `security` の指摘は自動投稿しない。レビューの報告でユーザーに渡し、ユーザーが経路を決める。推奨の経路は次の順:
  1. PR がまだマージされていない（main に入っていない）なら、悪用される本番は無い。Devin の新しいセッションを CLI で起動し（`devin --cloud --model swe-2-<同じ effort> -p "<ブランチ名> に push して直す。詳細: …"`）、PR には書かない。Devin のセッションはリポジトリの外で非公開のため。
  2. Devin の監視が止まっているか直せないときは、Devin の作業が終わっているのを確かめてから、Claude が同じブランチに修正を commit する。
  3. 既に main に入っている問題なら、GitHub の Security Advisory（非公開）で扱う。
- PR コメントには `security` があることも書かない（「非公開で追加の修正を依頼しました」とも書かない。手がかりになるため）。PR 本文や Devin の返信に詳細が出たら、ユーザーに伝える。
- 前例として #35 では DB URL がログに出る問題を公開コメントで依頼した。これは未マージのブランチの問題で本番の影響は無かったが、今後は上の経路に乗せる。
- 自動投稿されるのはユーザーのアカウント（gh の認証）からのコメントになる。投稿する分類を `must` / `nit` に限り、本文に秘密・環境変数・ローカルのパスを入れない。
- 記録（公開リポジトリに入る）の `security` の `summary` は `(非公開)` にする。

## 性能

対象外に近い。待機は既定 60 秒ごとに `gh pr view` 1 回（GitHub API の上限 5000/時に対して十分小さい）。並行 3 本でも 180 回/時。

## テスト方針

`node --test` で、純粋関数を固定する。gh は呼ばない。

- `wait-for-pr-update`: `--since` より前の head だけ → 未更新 / 後の head で CI 実行中 → 未更新 / 後の head で CI 完了（成功・失敗）→ 更新あり / PR が CLOSED・MERGED → exit 4 相当 / チェックが 0 件（CI が無い）→ 完了とみなす / 引数の誤り。
- `delegation`: init の必須引数（model の値の制限）と重複作成のエラー / review の追記と同じ round の重複エラー / finding の文字列の解析（`:` を含む summary）/ YAML の書き出しと読み戻しが一致 / finalize の gh 応答から `gh:` を組み立てる関数 / summary の集計（モデル別・分類別・Issue 単位の数え方・閾値・security の閾値）/ 記録が 0 件。
- `suggest-pr-watch`: 促す文に `delegation.mjs init` が含まれる。
- 手動の結合確認: 実際の Devin の PR 1 本（#43 か #44 の後の次の委譲）でループを 1 周回し、結果を日次ログに書く。#43・#44 には使わない（元のセッションが担当）。

## 移行とリリース

1. この設計書の承認。
2. 実装（本ブランチ `claude/loving-bun-c3f017`）→ `npm run test:harness` と品質ゲート → PR → ユーザーのマージ。
3. マージ後、既存の委譲の初期データを入れた状態から運用を始める。進行中の #43・#44 は元のセッションが旧手順で扱い、記録は後から `init`（model はユーザーから聞いた値）＋ `finalize` で起こす。
4. ロールバック: 本 PR を revert すれば旧手順（了承してから投稿）に戻る。記録ファイルは残っても害がない。

## リスク

| リスク | 対策 |
| --- | --- |
| `must` の判定を誤り、不要な修正を Devin にさせる | 上限 2 回。`decision` の分類で迷うものはユーザーへ。記録の `escalations` と round を見て、判定の癖を見直す |
| Devin と Claude の指摘の往復が止まらない | 上限 2 回。同じ指摘が直らなければ即ユーザーへ |
| セキュリティの問題を `must` に誤分類して公開してしまう | レビューの手順で「認証・ログ・外部入力に関わる指摘は、まず `security` に当たるかを確かめる」を必須にする。迷ったら `security` |
| Claude のセッションが終わると待機も止まる | 既存の `wait-for-pr.mjs` と同じ制約。時間切れ・セッション終了時は、日次ログの「次回やること」に PR 番号と round を書く |
| Devin の監視の仕様変更（`(aside)` や write 権限の条件） | 投稿後 30 分以内に Devin の反応（返信かコミット）が無ければ、待機の結果とともにユーザーに伝える |
| 記録の書き忘れ | `finalize` を close-session の手順に入れる。記録が無くてもループは回る |

## 未決事項

推奨を先に書く。

1. **自動投稿の範囲** — 推奨: `must` と、同じ回の `nit`。`nit` だけのときは投稿せず「マージ可」＋後続 Issue 案。別案: `nit` も常に自動投稿（手戻りが増える）／ `must` だけ（`nit` がすべて後続 Issue になり Issue が増える）。
2. **再レビューの上限** — 推奨: 自動の投稿は 2 回（round 2 まで）。別案: 1 回（ユーザーの負担が増える）／ 3 回（Devin の往復のコストと時間が増える）。
3. **昇格の閾値** — 推奨: 異なる Issue で 3 件（既存と同じ）。`security` だけ 2 件。別案: すべて 3 件（既存に完全に合わせる）。
4. **セキュリティ指摘の経路** — 推奨: 上の 1→2→3 の順（未マージなら Devin の非公開セッションで直させる）。PR には何も書かない。別案: 常に Claude が直す（Devin の作業との衝突に注意が要る）。
5. **記録の形式** — 推奨: YAML（既存の metrics と揃い、人が読みやすい）。ただし自前の最小パーサになる。別案: JSON（パーサ不要・壊れにくいが、既存の metrics と形式がずれる）。
6. **記録を入れる PR** — 推奨: その日の締め（close-session）の PR にまとめる。別案: 委譲ごとに記録だけの小さな PR（PR が増える）。
7. **`Closes #N` の書き忘れ（#33）を `devin-workflow` に今すぐ足すか** — 推奨: 足さない（1 件のみで減速ルールに反する。`wait-for-pr.mjs` がブランチ名でも拾うので実害は小さい）。記録で数え、3 件で昇格。
8. **自動投稿の承認** — この設計の承認をもって、`must` / `nit` の自動投稿の恒常的な許可とみなしてよいか（`review-devin-pr` と `AGENTS.md` に明記する）。
