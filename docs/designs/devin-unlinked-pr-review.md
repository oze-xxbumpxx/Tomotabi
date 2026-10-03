# 設計書: devin-unlinked-pr-review

- ステータス: draft（ユーザーの承認待ち）
- レベル: L2 / ユーザー承認: 必要（ハーネス`.claude/`・`AGENTS.md`の変更。スクリプト・フック・スキル・記録の形式にまたがる）
- 関連: `docs/designs/devin-delegation-loop.md`（前提の設計）/ `.claude/skills/review-devin-pr/SKILL.md` / `.claude/scripts/wait-for-pr.mjs` / `.claude/scripts/delegation.mjs` / `docs/devin-setup.md`

## 背景

いまの自動レビューは **Issueが起点**になっている。`gh issue create` → フック（suggest-pr-watch）→ `wait-for-pr.mjs <Issue>` → `review-devin-pr`。Issueを作らなければ、待機も始まらない。

一方、DevinはIssueに紐づかないPRを自分から出すことがある。

| PR | ブランチ | 作成者 | 中身 |
| --- | --- | --- | --- |
| #36 | `devin/pr-template` | devin-ai-integration[bot] | PRテンプレートの新設 |
| #53 | `devin/update-skills-1790414398` | devin-ai-integration[bot] | `.agents/skills/testing-web-ui/SKILL.md`の追加（#51のUI検証で得た知見） |
| #54 | `devin/update-blueprint-1790414400` | devin-ai-integration[bot] | `.devin/blueprint.yaml`のknowledgeに1行追記 |

#53・#54はクラウドのセッションが作業の終わりに出したもので、**ハーネス（`.agents/`・`.devin/`）を変えるPR** だった。`devin-workflow`が「ユーザーの確認なしに変えない」「変えるなら重点レビュー」としている範囲なのに、今は人が見つけたときにしかレビューされない（`docs/devin-setup.md`に「見つけたら通常のPRと同じくレビューする」とあるだけ）。

## 目的

1. Devinが出したIssueなしのPRを、Claude Codeが見つけて自動でレビューする。
2. レビュー → 修正 → 再レビューのループ・上限・セキュリティの扱いは、既存（`devin-delegation-loop`）をそのまま使う。
3. 記録と集計にも入れ、同じ種類の指摘の繰り返しを数えられるようにする。

## 要件

- R-1: 対象は「`devin/`で始まるブランチのPR」で、「委譲の記録があるIssueに紐づいていない」もの。作成者（bot / ユーザー）では絞らない（ローカルのDevinはユーザーのアカウントでPRを作るため。#50）。
- R-2: 同じPRを二重にレビューしない。レビュー済みの印は、既存の`<!-- claude-review round=<n> -->`のコメント、または委譲の記録で判断する。
- R-3: 見つける仕組みは、Claudeのターンでポーリングしない（既存と同じ。バックグラウンドのスクリプトかフックに任せる）。
- R-4: ghが使えない環境（クラウドのセッションなど）では、何もせず静かに終わる。セッションを止めない。
- R-5: Issueが無いので、範囲の基準は「PRの説明」と「ハーネスの規則」にする。ハーネスを変えるPRは重点レビューにする。
- R-6: 新しいスクリプト・フックの判定は純粋関数にし、`.claude/tests/`に`node --test`のテストを付ける。

## 対象範囲

- IssueなしPRの検出（待機スクリプトとセッション開始時の確認）。
- `review-devin-pr`への「IssueなしPR」の節の追加（レビューの観点・範囲の基準）。
- 委譲の記録をPR番号でも作れるようにする（`pr-<n>.yml`）。集計に含める。
- 過去分: #53・#54を記録として起こす（マージ済み。指摘は分かる範囲）。#36は委譲の記録の仕組みより前で、指摘の記録も無いので起こさない。

## 対象外

- Devin以外（Codex・人）のPRの自動レビュー。
- GitHub ActionsでClaudeを動かすレビュー（下の「比較」参照。APIキーの秘密情報と費用が要り、ADR級）。
- Devin側の設定変更（知見のPRを出させない、など）。
- Claudeのセッションが無い間の検出（下の「制約」参照）。

## 現状構成

```
gh issue create ─(hook)→ wait-for-pr.mjs <Issue> [background] ─→ review-devin-pr
                                                                   ↑
Devin が自分から出した PR（Issue なし）─────── 検出の経路なし ───────┘（人が気づいたときだけ）
```

## 変更後構成

```
(1) 委譲のとき（既存の経路に 1 本足す）
    gh issue create ─(hook)→ wait-for-pr.mjs <Issue>              [background]（既存）
                           └→ wait-for-devin-pr.mjs --since <今>  [background]（新規。セッションで 1 本）
                                  │ exit 0: 新しい Issue なし PR の番号（JSON 行）
                                  ▼
                           delegation.mjs init pr-<n> → review-devin-pr（「Issue なし PR」の節）→ 以降は既存のループ

(2) セッション開始時（取りこぼしの受け皿）
    SessionStart hook: find-devin-prs.mjs
       open の devin/* PR のうち、Issue に紐づかず、claude-review の印も記録も無いものを一覧にして
       additionalContext で「review-devin-pr でレビューする」と促す（起動はしない）
```

### 「IssueなしPR」の判定（`findUnlinkedDevinPrs`）

次をすべて満たすPR:

1. `headRefName`が`devin/`で始まる。
2. `--since`以降に作られた（待機のとき）/ stateがOPEN（セッション開始時）。
3. `wait-for-pr.mjs`の`findLinkedPr`の規則（`closingIssuesReferences`・本文の`Closes #N`・ブランチ名の末尾`-N`）で、**委譲の記録があるIssueに紐づかない**。紐づくPRは既存の経路で待っているので対象外（二重レビューを避ける）。記録の無いIssueに紐づくPRは誰も待っていないので対象にする。
   - 注意: `devin/update-skills-1790414398`のように末尾が数字のブランチは、`-N`の規則で「Issue #1790414398に紐づく」と読めてしまう。記録のあるIssue番号に限ることで、この誤読も避ける。
4. レビュー済みでない: 委譲の記録（Issueの記録の`gh.pr`、または`reviews`が1件以上ある`delegations/pr-<n>.yml`）が無く、PRのコメントに`<!-- claude-review`の印も無い。`init`だけで中断した記録（`reviews`が空）はレビュー済みにしない（PR #61のレビューで修正）。

### レビューの観点（`review-devin-pr`に節を足す）

Issueの「やること」が無いので、範囲とレビューの基準を次に置き換える。分類・判定・自動投稿・上限・セキュリティの経路は既存の表をそのまま使う。

| 観点 | 見ること |
| --- | --- |
| 説明 | PRの説明に「何を・なぜ」があるか。どのタスク（Issue / PR）から得た知見か |
| 範囲 | 説明と変更ファイルが合っているか。知見のPRにアプリのコードが混ざっていないか |
| ハーネス（`.claude/`・`.agents/`・`.devin/`・`AGENTS.md`・`CLAUDE.md`） | **重点レビュー**。既存の規則（`AGENTS.md`・`devin-workflow`・既存スキル）と食い違わないか、重複していないか。blueprintに規約や手順を書いていないか（`docs/devin-setup.md`: knowledgeは環境のコマンド参照だけ） |
| 事実 | 書かれたコマンド・環境変数・ポート・ファイルが実在し、正しいか（例: #54の`PUBLIC_APP_ORIGIN`とOriginGuard） |
| 秘密 | 秘密・環境変数の値・ローカルのパス・Devinのセッション外の情報が入っていないか |
| 他リポジトリ | Cookpit専用のスキルや存在しない成果物を前提にしていないか |

- ハーネスを変えるPRで、既存の規則と食い違う・規則そのものを変える内容は`decision`（ユーザーの判断）にする。事実の誤り・重複・置き場所の誤りは`must`。
- `Closes #N`が無いことは指摘しない（`pr-metadata`にしない）。
- 新しいcategory案: `knowledge-inaccurate`（知見の事実が誤り）、`harness-conflict`（既存の規則と食い違う・重複）。`delegations/README.md`の語彙に足す。

### 修正を頼む先

既存の「自動投稿」の手順どおり。クラウドのDevinのPRはDevinがPRのコメントに自動で対応する。ローカルのDevinが出したPR（ユーザーのアカウント）は、新しいローカルセッションを起動して直させる。どちらか分からないときは作成者で見る（bot → クラウド、ユーザー → ローカル）。

## データフロー

### 記録（`docs/claude-code/improvements/delegations/pr-<n>.yml`）

既存の形に`pr`と`origin`を足し、`issue`は`null`にする。

```yaml
issue: null
pr: 53
origin: 'self'            # 'issue'（既存。省略時）| 'self'（Devin が自分から出した）
title: 'docs(skills): testing-web-ui スキルを追加（web の UI 検証手順）'
agent: 'devin'
model: 'unknown'          # クラウドは既定の SWE-2 High と分かっていれば swe-2-high
runner: 'cloud'           # 作成者が bot → cloud、ユーザー → local
change_level: 0
delegated_at: '2026-09-26T09:20:01Z'   # PR の作成日時（Issue が無いため）
reviews: []
escalations: 0
outcome: null
gh: null
```

- `delegation.mjs init pr-<n>`で作る（`<Issue>`の代わり）。題・作成日時・作成者はghから取る。`review` / `finalize`も`pr-<n>`の指定で同じ記録を扱う。
- `finalize`はPR番号が分かっているのでIssueからの検索をしない。`closes_linked`は`null`。
- 集計（`summary`）は、分類の件数を「指摘が出た委譲の数」で数える（キーはIssue番号か`PR#n`）。「Issue→PR中央値」は`origin: self`を除く（Issueが無く0分になるため）。モデル別の表に加えて`origin`別の行を出す。

## API設計

アプリのAPIは変えない。スクリプトのCLI:

| コマンド | 役割 | 終了コード |
| --- | --- | --- |
| `node .claude/scripts/wait-for-devin-pr.mjs --since <ISO> [--interval 秒] [--timeout 秒]` | `--since`以降に作られたIssueなしDevin PRが1本以上できるまで待つ。見つかったPRをすべてJSON行で出す`{pr, url, title, headRefName, author}` | 0見つかった / 2引数誤り / 3時間切れ（既定8時間） |
| `node .claude/hooks/find-devin-prs.mjs` | SessionStart。未レビューのIssueなしDevin PR（OPEN）を一覧にして促す | 常に0 |
| `node .claude/scripts/delegation.mjs init pr-<n> [--model <m>] [--runner <local\|cloud>] [--level 0-3]` | IssueなしPRの記録を作る。`--model`省略時は`unknown`、`--runner`省略時は作成者から推す | 0 / 2 / 3 |

- `listPrs`と`findLinkedPr`は`wait-for-pr.mjs`のものを使い回す（export済み）。判定は`findUnlinkedDevinPrs(prs, { since, delegatedIssues, reviewedPrs })`の純粋関数に閉じ込める。
- レビュー済みの確認（コメントに`<!-- claude-review`）は、待機とセッション開始時の両方で、候補のPRごとにghで見る（別のセッションが先にレビューしたPRを二重に通知しないため）。取得の失敗はPRごとに扱い、他のPRを捨てない（待機は次の周期で再確認、フックは「未確認」として出す）。
- 待機は見つけると終わる。同じセッションで後から出るPRを拾うため、レビューに入る前に同じ`--since`と、通知済みのPRの`--exclude`で起動し直す。

## DB設計 / フロントエンド設計 / バックエンド設計

対象外（アプリのコードは変えない）。変更するハーネスのファイル:

| ファイル | 変更 |
| --- | --- |
| `.claude/scripts/wait-for-devin-pr.mjs` | 新規 |
| `.claude/hooks/find-devin-prs.mjs` | 新規（SessionStart） |
| `.claude/settings.json` | SessionStartに`find-devin-prs.mjs`を足す |
| `.claude/scripts/delegation.mjs` | `init pr-<n>`・`pr-<n>.yml`・`origin`・集計のキー |
| `.claude/hooks/suggest-pr-watch.mjs` | 促す文に`wait-for-devin-pr.mjs --since`の起動を足す（セッションで1本） |
| `.claude/tests/wait-for-devin-pr.test.mjs`・`find-devin-prs.test.mjs` | 新規 |
| `.claude/tests/delegation.test.mjs`・`suggest-pr-watch.test.mjs` | 追加 |
| `.claude/skills/review-devin-pr/SKILL.md` | 「IssueなしPR」の節（検出・観点・記録）。descriptionにIssueなしPRを足す |
| `docs/claude-code/improvements/delegations/README.md` | `pr-<n>.yml`・`origin`・新しいcategory |
| `docs/claude-code/improvements/delegations/pr-53.yml`・`pr-54.yml` | 過去分 |
| `docs/devin-setup.md` | 「見つけたらレビューする」を自動レビューの説明に置き換える |
| `AGENTS.md` | Devinの節に1行:「Issueに紐づかないDevinのPRも同じ手順でレビューする」 |

## 検出の方式の比較

| 観点 | A: 待機スクリプト＋セッション開始時の確認【推奨】 | B: セッション開始時の確認だけ | C: GitHub ActionsでClaudeがレビュー | D: クラウドの定期実行（Routine） |
| --- | --- | --- | --- | --- |
| 見つかるまで | 委譲中のセッションなら数分。その後は次のセッション開始時 | 次のセッション開始時 | PR作成の直後 | 定期（最短1時間） |
| 追加の仕組み | スクリプト1・フック1 | フック1 | ワークフロー・APIキーのSecret・費用 | Routine。クラウドにはghが無く、GitHub MCPで書き直しが要る |
| 既存との整合 | `wait-for-pr.mjs`と同じ作り。レビューはローカルのClaude（ハーネス・手順が揃う） | 同左 | 別の実行環境で`review-devin-pr`の手順（Devinの起動・記録）を再現できない | 手順の一部（ローカルのDevin起動）が使えない |
| 判断 | 採用 | Aの一部として採用 | ADR級。今回は対象外 | 今回は対象外 |

推奨はA。#53・#54は委譲（#51）の作業の終わりに出ており、委譲中のセッションで待てば大半を拾える。拾い損ねは次のセッション開始時に拾う。

## 制約

- Claudeのセッションが無い間は検出しない（既存の`wait-for-pr.mjs`と同じ制約）。次のセッション開始時に拾う。
- 待機はセッションで1本（Issueごとではない）。suggest-pr-watchは「まだ起動していなければ」と促す。二重に起動しても、記録の有無で二重レビューにはならない（`init`が既存の記録でエラーになる）。

## エラー処理

- (a)リトライ: ghの一時的な失敗は次の周期で再試行（既存と同じ）。
- (b)タイムアウト: `execFileSync`に30秒のタイムアウト。フックは全体で10秒を超えたら何も出さずに終わる。
- (c)冪等性: `init --pr`は既存の記録があればエラー。フックは読み取りだけ。
- (d)部分失敗: 記録の書き込みは既存どおり一時ファイル → rename。
- (e)フォールバック: ghが無い・未認証なら、フックは何も出さずexit 0（R-4）。

## ログと監視

- 待機スクリプトは、開始・見つかった・時間切れ・ghの失敗を1行ずつ出す（既存と同じ）。
- 集計の`origin`別の行で、IssueなしPRの件数と一発合格率を見る。

## セキュリティ

- 既存の経路どおり。`security`の指摘は投稿しない。
- 知見のPRは、Devinが作業中に見た値（環境変数の値・ローカルのパス・セッションのURL以外の内部情報）を書き込みやすい。「秘密」の観点を必須にし、見つかったら`security`としてユーザーに渡す（公開リポジトリのため、PRが開いている時点で見えている。ユーザーにPRを閉じる・履歴を消すかの判断を仰ぐ）。

## 性能

待機は60秒ごとに`gh pr list` 1回（既存の`wait-for-pr.mjs`と同じ規模）。フックはセッション開始時に`gh pr list` 1回と、対象のPRごとにコメント取得1回。

## テスト方針

`node --test`で純粋関数を固定する。ghは呼ばない。

- `findUnlinkedDevinPrs`: `devin/`以外のブランチは対象外 / `Closes #N`・`closingIssuesReferences`・記録のあるIssueの`-N`で紐づくものは対象外 / 記録の無い番号の`-N`（`update-skills-1790414398`）は対象 / `--since`より前は対象外 / 記録（`pr-<n>`）がある・claude-reviewの印があるものは対象外 / 複数見つかったら番号順ですべて返す。
- `find-devin-prs`: 対象0件なら何も出さない / 1件以上ならadditionalContextにPR番号と`review-devin-pr` / ghの失敗で何も出さずexit 0。
- `delegation`: `init pr-<n>`の記録の形 / `review`・`finalize`の`pr-<n>`指定 / `summary`のキー（IssueとPRの混在）と`origin: self`をIssue→PR中央値から除くこと / 既存のIssueの記録が今までどおり読めること。
- `suggest-pr-watch`: 促す文に`wait-for-devin-pr.mjs --since`が含まれる。
- 手動の結合確認: 次のクラウド委譲で、Devinが知見のPRを出したら拾えるかを日次ログに書く。

## 移行とリリース

1. この設計書の承認。
2. 実装（本ブランチ`claude/tomotabi-loop-question-wp239g`）→ `npm run test:harness`と品質ゲート → PR → ユーザーのマージ。
3. マージ後、過去分（#53・#54）の記録を入れた状態から運用を始める。
4. ロールバック: 本PRをrevertすれば、IssueなしPRは人が気づいたときのレビューに戻る。記録ファイルは残っても害がない（`summary`が`pr-<n>.yml`を読めなくなるだけなので、revertするときは記録も消す）。

## リスク

| リスク | 対策 |
| --- | --- |
| 数字で終わるブランチ名をIssueの紐づけと誤読し、見落とす | 記録のあるIssue番号のときだけ紐づきとみなす。テストで固定 |
| Devin以外（人）が`devin/`ブランチを使い、意図せずレビューが走る | 投稿は`must`だけで、上限2回。人のPRと分かったら記録を消して止める |
| 知見のPRにDevinが反応しない（元のセッションが終わっている） | 既存の`wait-for-pr-update.mjs`の時間切れでユーザーに伝える。知見のPRは小さいので、ユーザーの判断でClaudeが直してもよい |
| セッション開始時のフックが遅くなる | 10秒の上限。ghが無ければ即終了 |

## 未決事項

推奨を先に書く。

1. **検出の方式** — 推奨: A（待機スクリプト＋セッション開始時の確認）。別案: B（セッション開始時だけ。仕組みは小さいが、見つかるのが遅い）／C（GitHub Actions。すぐ見つかるがAPIキーと費用が要りADR級）。
2. **対象の絞り方** — 推奨: `devin/`のブランチすべて（作成者で絞らない）。別案: 作成者がdevin-ai-integration[bot]のPRだけ（ローカルのDevinのPRを拾えない）。
3. **記録を残すか** — 推奨: 残す（`pr-<n>.yml`。知見のPRの指摘も昇格の数に入れる）。別案: 残さない（仕組みは小さいが、繰り返しを数えられない）。
4. **ハーネスを変える知見のPRの扱い** — 推奨: 既存の規則を変える・食い違う内容は`decision`でユーザーへ、事実の誤り・重複は`must`で自動投稿。別案: ハーネスを変えるPRはすべてユーザーへ（安全だが、自動にしたい今回の目的から外れる）。
5. **過去分** — 推奨: #53・#54を記録に起こす。#36は起こさない（指摘の記録が無い）。
