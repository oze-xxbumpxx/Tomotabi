# Orchestrationポリシー

Orchestrator（`claude-opus-5`）は**指揮役**であり、自分で詳細設計や大量の実装を
完結させない。タスクを分解し、専門Subagent（`claude-sonnet-5`）へ委譲する。

`Agent`ツールを持つのはorchestrator・agent-improvement-managerの2つ（実務委譲）と、
回帰評価目的のmanager→evaluator。orchestratorは常備10 Agentを起動できる
（定義は`.claude/agents/`）。reviewerは他Agentを起動しない（事実確認は自身のRead/Grep）。
他のSubagentは`Agent`を持たず、互いを起動しない。

> 起動しない: requirements-analyst / performance-designer /
> e2e-test-implementer / document-reviewer / contract-designer。

## Orchestratorの責務

1. ユーザー要求の分析
2. 変更レベルの判定（[document-policy.md](./document-policy.md)）
3. タスクの分解
4. 必要なSubagentの選定
5. 実行順序と依存関係の決定
6. 並列実行可能な作業の判定
7. Subagentへの明確なコンテキスト提供
8. 各成果物の統合
9. エージェント間の矛盾解消
10. 完了条件の確認（[development-workflow.md](./development-workflow.md)）

OrchestratorはSubagentの出力を**無条件で採用しない**。要件・設計・実装計画・
実装・試験の間に矛盾がないか確認し、矛盾があれば該当Subagentへ差し戻す。

## 委譲時に必ず伝えること

Subagentへ依頼する際、最低限これらを明示する。

- **目的** … 何のための作業か
- **対象範囲** … 触れてよいファイル・領域
- **対象外** … 触れてはいけない領域
- **参照すべきファイル** … 設計書・既存実装・恒久ドキュメント
- **期待する成果物** … 出力の形式
- **出力先** … 保存パス（`docs/designs/<feature>.md`等）
- **完了条件** … どうなれば完了か
- **禁止事項** … スコープ外変更・無断の設計変更など

## 委譲フロー（レベル別）

### Level 1

- 必要に応じimplementerに直接修正を依頼、またはOrchestratorが確認のみで完結。
- 設計書・計画は作らない。最終報告に変更理由と確認内容を記載。

### Level 2

```
architecture-designer          → docs/designs/<feature>.md（契約変更があれば Contract 節も）
  → implementation-planner     → docs/implementation-plans/<feature>.md
  → test-designer（計画と並行可） → docs/tests/<feature>.md
  → implementer                → 実装 + 単体テスト + lint/型チェック/テスト
  → reviewer                   → 指摘（必要なら docs/reviews/<feature>.md）
  →〔security-reviewer（省略条件あり・§起動条件参照）〕→ セキュリティ指摘
  → reflection-agent           → improvements/candidates/<task-id>.md
```

### Level 3

```
architecture-designer
    → docs/requirements/<feature>.md + docs/designs/<feature>.md
      （外部I/O/大量データ時は設計書の性能節も厚く書く。契約変更があれば Contract 節も）
  → implementation-planner     → docs/implementation-plans/<feature>.md
  → test-designer              → docs/tests/<feature>.md
  → implementer                → 実装 + 単体テスト +〔E2E基盤整備済みなら E2E〕
  → reviewer                   → docs/reviews/<feature>.md（文書観点含む）
  → security-reviewer          → セキュリティ指摘
  → reflection-agent           → improvements/candidates/<task-id>.md
```

## 実装ルートの分岐（Codex委譲）

実装ルートの正典は`AGENTS.md`。Codex委譲スキル（`create-codex-brief` /
`review-codex-implementation` / `codex-delegation-playbook.md`）は未導入のため、
**実装はimplementer経路を使う**。上流（要件〜試験計画）と下流（振り返り）は省略しない。

```
…→ implementation-planner → test-designer →┬→ implementer（Orchestrator 経路）────────────┬→ reviewer →…
                                           └→ create-codex-brief → Codex 実装（人間が実行） ┘
                                              → review-codex-implementation（受け入れレビュー）
```

Codex委譲時の必須規律（2026-07-06 Task 01のmain直コミット・レビュー記録なしの再発防止）:

1. **作業ブランチ必須**。mainへの直コミットは禁止（正典: `AGENTS.md`。lefthookは未導入）。
2. **受け入れレビュー必須**。reviewer工程を省略しない。`docs/reviews/README.md`（Gate B）は
   未作成のため、指摘と検証結果をPR / 日次ログに残す。
3. **引き渡しhard stop**。PR作成・「人間レビュー待ち」報告の前に
   `node .claude/scripts/review-readiness.mjs handoff-check --feature <feature>`が
   exit 0であること（legacy不可）。PR/チャット要約は`handoff-blurb`を使い、
   正本は常に`docs/reviews/`。承認語は書かない。
4. **reflection-agentはCodexルートでも実施**する（feature完了時）。
5. 実装途中でルートを切り替えた場合（Orchestrator ⇔ Codex）、実装計画の「実装ルート」欄を
   更新し、切替理由を日次ログに残す。
6. **PR作成・マージの主体**: 受け入れレビュー（handoff-check成功）後、作業ブランチからの
   draft/open PR作成はOrchestrator（またはレビュー実施セッション）が行い、
   **mainへのマージ判断は人間**が行う。
   （出典: shopping-list-core事象7 — 合格後の受け渡しが暗黙だった問題の明文化）

## 並列実行の指針

- L3では`architecture-designer`（requirements + design）を先行させる。orchestratorの
  先行調査フェーズ（任意）で所在情報を渡してよい。
- `architecture-designer`完了後、`implementation-planner`と`test-designer`は
  並列に進められる（どちらも設計書を入力にするため）。
- 契約の設計は`architecture-designer`が設計書のContract節で担う（専用Agentは未定義）。
- 性能観点は`architecture-designer`の条件付き節で設計書に含める（単独Agentは起動しない）。
- `implementer`は実装計画の確定後に着手する。E2Eも同Agentが条件付きで担当する。
- `reviewer`は実装完了後。設計・計画・実装・試験を突き合わせる。

## 再開時の完了判定（1原則）

resume・再開直後（stop/resume・強制中断・killedからの復帰を含む）はnotificationを
待たず、**直前までに委譲した未確認のSub-agentすべてについて、それぞれの期待成果物の
存在・更新時刻で完了を冪等判定してから次を決める**。完了した分は次工程へ進め、
未完了のものだけを再委譲する（並列background委譲の部分完了では、完了済みSub-agentを
再起動しない）。単一委譲・並列委譲を問わず適用する（「完了待ちループ」と二重起動の
両方を防ぐ。出典: IMP-2026-009の一般化。単一委譲での実績: meal-plan-screens 2026-07-09 /
pantry-screens 2026-07-19。並列委譲は同判定を各成果物へ適用する）。

> 旧stop/resume機構（`inflight-agents.json`）の運用は停止。配布元のarchive文書は
> Tomotabiに無いので参照しない。

## 契約変更時の扱い

専用のcontract-designerは未定義。次のいずれかに該当したらarchitecture-designerの
設計書にContract節を必ず書く。L2の「APIフィールド追加」も該当すれば必須。

1. 公開API / イベント / CLIの入出力にフィールドの追加 / 変更 / 削除がある。
2. DBスキーマに列・制約・型の追加 / 変更 / 削除がある。
3. 層をまたぐDTOの形が変わる。
4. 必須⇔任意・nullability・enum・最大長などバリデーション境界が変わる。
5. エラー形式・冪等性キーなど外部から観測される契約が変わる。

**書かない（過剰工程の禁止）**: 契約の形が変わらない内部リファクタ、文書のみ、L1の軽微修正。

## security-reviewerの起動条件

**L1では起動しない。** L3は原則必須（下記のドキュメントのみ例外を除く）。
L2はセキュリティ触点があるとき必須、省略条件に該当すれば省略してよい。

### 必ず起動する（L2/L3）

次のいずれかに該当したら`reviewer`の後に必ず起動する。

1. 認証・認可・セッション・Cookie / セキュリティヘッダーの新設・変更がある。
2. 秘密情報（トークン・APIキー・個人情報）の取り扱いが変わる、またはログ出力経路が変わる。
3. Infrastructure経由の外部API / 外部ストレージI/Oを新設・変更する。
4. 依存パッケージの追加・メジャー更新がある（`package.json` / lockfile）。
5. 入力境界の新設・変更で、未検証入力が業務ロジックに届きうる変更がある。
6. L3の全層変更（新規API / DBスキーマ / データ移行を含むもの）。

### 省略してよい（L2限定・過剰工程の禁止）

次の**すべて**を満たすL2では省略してよい。省略した場合は最終報告に「省略理由」を1行書く。

- Presentationのみ、または契約・DB・認証に触れない内部リファクタ / テスト基盤のみ。
- 依存パッケージの追加・メジャー更新がない。
- 秘密情報・外部I/O・認証認可に触れていない。

L2/L3共通で省略してよいケース:

- ドキュメント / コメント / テキスト文言のみの変更（コード変更がない）。
- `documentation-only-change`相当の変更。

判断に迷う場合は起動する側に倒す。

`security-reviewer`は`reviewer`と役割を分担する:

- `reviewer`: 品質・整合性・責務分離・エラー処理・テスト不足を見る。
- `security-reviewer`: OWASP Top 10・認証/認可・秘密情報漏洩・依存脆弱性を見る。

## パフォーマンス設計（architecture-designer条件付き・旧performance-designer）

**L3のみ**、かつ次のいずれかを含む場合に`architecture-designer`が設計書の性能節を厚く書く。
単独のperformance-designerは起動しない（IMP-2026-031）。

1. Infrastructure経由の外部API / 外部ストレージへのI/Oを新設・変更する。
2. 一覧取得・集計など大量データを扱うDBクエリを新設・変更する。
3. 性能要件が明示された改善タスク。

## E2E・結合テスト（implementer条件付き・旧e2e-test-implementer）

**L3のみ**、かつ次のいずれかを満たす場合に`implementer`がE2E/結合テストも実装する。
単独のe2e-test-implementerは起動しない（IMP-2026-031）。

1. `apps/web/playwright.config.ts`が存在する（Playwright基盤整備済み）。
2. 対象Honoルートにテストクライアント用のセットアップが存在する。

テスト基盤が整備されていない場合は実装せず、観点は`docs/tests/<feature>.md`の
「未実装観点（基盤待ち）」セクションに記録するにとどめる。

## モデル割り当て

正典は各`.claude/agents/<name>.md`のfrontmatter `model`（下表は常備10 Agentの早見。
IMP-2026-031）。モデルは「作業量」ではなく「判断の重さ」で選ぶ。采配基準は次の4層。

### 采配基準（4層）

| 層                 | 作業タイプ                                                                    | モデル                                                   |
| ------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| 軽い               | ファイル確認・検索・差分や書式のチェック                                      | Haiku（組み込み`Explore`を`model: haiku`指定で起動） |
| 方針が決まっている | 確定済み方針での実装・編集・設計書/計画/試験計画の作成・ライティング          | `claude-sonnet-5`                                        |
| 判断がいる         | レビュー・練り直し・横断分析・オーケストレーション                            | `claude-opus-5`                                          |
| 特に重要           | L3の全体設計・方針決め・重大トレードオフ・最終確認（失敗すると手戻りが重い） | Fable（動的オーバーライドまたはメイン切り替え）          |

禁止事項（トークン浪費の典型パターン）：

- 探すだけ・見比べるだけの作業を上位モデルに回さない（`Explore`/haikuへ委譲する）。
- 決まりきった編集を上位モデルで大量にこなさない（implementer/sonnetへ委譲する）。
- 散らかったままの大量ファイルを、軽いモデルで整理する前に上位モデルへ流し込まない。

> `Explore`はClaude Codeの組み込みAgentのため`.claude/agents/`に定義ファイルが無い。
> `validate-agent-config.mjs`は`BUILTIN_AGENTS`（現状`Explore`）を存在チェックから除外する
> （IMP-2026-021）。組み込みを増やす場合は同Setに追加する。

### Agent別早見表

| Agent                     | model                                                     |
| ------------------------- | --------------------------------------------------------- |
| orchestrator              | `claude-opus-5`                                           |
| architecture-designer     | `claude-sonnet-5`（L3はFableオーバーライド。下記参照） |
| implementation-planner    | `claude-sonnet-5`                                         |
| implementer               | `claude-sonnet-5`                                         |
| test-designer             | `claude-sonnet-5`                                         |
| reviewer                  | `claude-opus-5`                                           |
| security-reviewer         | `claude-opus-5`                                           |
| reflection-agent          | `claude-sonnet-5`                                         |
| agent-evaluator           | `claude-sonnet-5`                                         |
| agent-improvement-manager | `claude-opus-5`                                           |
| （組み込み）Explore       | 呼び出し時に`model: haiku`を指定                        |

agent-evaluatorをSonnetに据え置く理由：採点基準表ありの定型評価で呼び出し回数が多い
（回帰評価で複数ケース実行）。悪化検知の最終判断はOpusのagent-improvement-managerが担う。

### Fableの使い方（L3限定）

- frontmatterにFableを固定しない（L2の小さな設計でも動いてしまいコスト増のため）。
- L3判定時のみ、orchestratorがarchitecture-designerをAgent呼び出しの`model: fable`
  オーバーライド（呼び出し時パラメータ。frontmatterより優先）で起動する。
- オーバーライドがCLIバージョンにより効かない場合のフォールバック：メインモデルをFableに
  切り替え（人間が実施）、設計判断だけメインで行い、成果物化はarchitecture-designer
  （Sonnet）へ委譲する。

### メインモデル切り替えガイド

切り替えは人間が行う（`/model`）。orchestrator・メインセッションのClaudeは、切り替えが
有益な場面で**タイミングと切り替え先を明示して**提案する。

| セッション/局面                           | 推奨メインモデル                |
| ----------------------------------------- | ------------------------------- |
| 単発の質問・軽い調査のみのセッション      | Sonnet                          |
| 通常の開発タスク（orchestrator・L1/L2）   | Opus（現行frontmatterどおり） |
| L3の方針決め・重大トレードオフ・最終確認 | Fable（提案して人間が切り替え） |

> `CLAUDE_CODE_SUBAGENT_MODEL`は設定しない。設定すると全Subagentのモデルを
> 一律上書きし、Agent定義の`model`より優先されてしまう。モデルは各Agentファイルの
> `model`で個別指定する。

### Cursor Agent経路（Claude Codeとは別）

`.cursor/agents/`と`.cursor/rules/implementation-default-model.mdc`は未設置。
Cursor Cloud Agentでは親セッションが`AGENTS.md`の作業分担に従って実装してよい。
Claude Code CLIでは`.claude/agents/implementer.md`のモデル指定を使う。

## 起動方法（正規ルート）

**Orchestrator役はメインセッションが務める。**

- ローカル: `claude --agent orchestrator`（メインセッション起動）。
- リモート: 通常セッションが本ポリシーに従い専門Subagentを直接起動する
  （実績: pantry-screens 2026-07-19）。
- **Orchestrator自体を`Agent`ツールの子エージェントとして起動する多段委譲は行わない**
  （孫Sub-agentの通知配送先・isolation未継承の既知問題により「成果物なし完了」が
  配布元で反復したため）。

メインセッションとして起動した場合、`tools`の`Agent(...)`で起動可能なSubagentを
制限できる。通常のSubagentとして起動するとこの許可リストは無視される点も、
メインセッション正規化の理由の一つ。
