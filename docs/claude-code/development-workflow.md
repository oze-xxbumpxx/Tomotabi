# 開発ワークフロー（Orchestrator主導）

このプロジェクトの機能追加・修正は、**Orchestratorが指揮**し、専門Subagentに
調査・設計・計画・実装・試験・レビューを委譲する形で進める。

CLAUDE.mdには常時必要な原則だけを置き、工程の詳細はこの文書と各Subagent定義
（`.claude/agents/`）、各Skill（`.claude/skills/`）に分離している。

## 標準フロー

```
ユーザー要求
  │
  ▼
Orchestrator … 変更レベル判定（L1/L2/L3）・タスク分解・委譲計画
  │
  ├─(L2/L3)→ architecture-designer …（L3 は requirements も）技術設計 → docs/designs/<feature>.md
  ├─(契約変更時)→ architecture-designer の設計書 Contract 節（専用 Agent は未定義）
  ├─(L2/L3)→ implementation-planner … 実装計画 → docs/implementation-plans/<feature>.md
  ├─(L2/L3)→ test-designer … 試験観点 → docs/tests/<feature>.md
  ├────────→ implementer … 実装 + 単体テスト +〔L3・基盤ありなら E2E〕+ lint/型チェック/テスト
  │           （実装ルートが Codex 委譲の場合はこの工程のみ Codex + review-codex-implementation
  │             で代替する。正典は orchestration-policy.md §実装ルートの分岐）
  ├─(L2/L3)→ reviewer … 整合性・品質・文書観点のレビュー
  ├─(L2/L3)→ security-reviewer … セキュリティ専門レビュー（L2 は省略条件あり・正典は orchestration-policy）
  └─(L2/L3)→ reflection-agent … 振り返り → improvements/candidates/<task-id>.md
  │
  ▼
Orchestrator … 成果物の統合・矛盾解消・完了条件確認 → ユーザー報告
```

L2/L3の機能は、分類の直後に論点の記録と進み具合（`docs/discussions/<feature>.md`・`<feature>.progress.json`）を作り、
問いと設計の承認は確認のページ（claude.aiの非公開のページ）でユーザーに出す。工程が変わるたびに
`node .claude/scripts/discussion.mjs stage <feature> <工程> <状態>`で進み具合を更新する
（設計: `docs/designs/discussion-workflow.md`。手順: `ask-questions`・`create-design-document`の「承認を頼むとき」）。

| 時点 | 進み具合の更新 |
| --- | --- |
| 問いを確認のページで出した | その工程を`waiting` |
| 答えを記録して本文を書き始めた | その工程を`active` |
| 要件定義書・設計書のPRを出した | その工程を`approval`（`--doc`で文書を足す） |
| そのPRがマージされた | その工程を`done --pr <番号>`、次の工程を`active` |
| 実装・レビュー・マージ・振り返り | それぞれ`active` → `done`。行わない工程は`skipped --reason` |

Level 1（軽微）は設計書・計画を省略し、implementer（または直接修正）→ 必要なら
reviewerの最小フローで進める。レベルの定義は
[document-policy.md](./document-policy.md)を参照。

## 人間レビューを二つのゲートへ分ける

人間を工程ごとの確認者にせず、AIが代替できない意思決定者として扱う。通常は次の2箇所だけで
確認を求める。

| gate                | 時点         | 人間が判断すること                         | AI / 機械が先に用意するもの        |
| ------------------- | ------------ | ------------------------------------------ | ---------------------------------- |
| A: design decision  | 実装前       | 複数案のtrade-off、不可逆変更、要件の主観 | 推奨案、反対案、影響、rollback     |
| B: merge acceptance | 実装・検証後 | 残余リスクの受容、UXの主観、マージ可否    | current packet、振る舞い差分、証拠 |

Gate Aは設計で意思決定が必要な場合だけ発生する。既存ルールから一意に決まる実装を、人間へ
形式的に確認しない。各gateの質問は原則3件以下にまとめ、質問ごとに推奨と根拠を付ける。
4件以上なら人間へ大量に渡さず、PR分割、設計判断の前倒し、追加証拠で圧縮する。

実装中は、スコープ変更、不可逆操作、新しい権限が必要な場合を除き、人間を細切れに中断しない。
確定可能な事項はAIとdeterministic gatesで処理し、未決事項を次のgateに集約する。

## Review state

L2/L3の新しいレビュー記録は`docs/reviews/<feature>.md`にcurrent-state packetと監査ログを
同居させる。

```text
draft ──証拠生成──┬── open BLOCK ──────────> ai_blocked
                  ├── 高影響の未検証 ─────> evidence_pending
                  └── 上記なし ───────────> human_review_requested

review subject が変化: いずれの保存状態からも stale → 再検証
human_review_requested: Gate B で人間が受容または差し戻し
```

- `human_review_requested`はAIの承認ではなく、人間へ渡せる状態。
- Reviewerは候補指摘をintroduced-by-diff / evidence / CI重複 / 根本原因重複で検証する。
- 指摘はaction / impact / evidence / statusの4軸で記録する。
- 人間項目は`subjective` / `irreversible` / `unknown`だけ、最大3件。
- subject digestはstaged index（ローカル）またはbase-to-head diff（CI）から計算する。
- 詳細は[reviews README](../reviews/README.md)を正典とする。

### L3のsubject freeze

L3のcandidate / metricsはreview結果を入力にする一方、review文書と違ってdigest対象である。
そのため、意味 / security reviewの指摘解消後にcandidate / metricsを確定し、全非review変更を
stageしてfinal subjectを作る。Reviewerは前回からの差分をclosure reviewし、その後は
`docs/reviews/<feature>.md`だけを生成する。非reviewファイルをさらに変えたらfinal subjectを
再計算する。人間はclosureの途中ではなく、current packetができたGate Bで1回判断する。

## 実装前に必ず満たす条件

L2/L3の実装に着手する前に、以下が揃っていることを確認する。

- `docs/designs/<feature-name>.md`（確定済み設計）
- `docs/implementation-plans/<feature-name>.md`（実装計画）

これらが無い、または必須セクションが空のまま実装に入らない。設計から逸脱する必要が
生じた場合、implementerは独断で変更せずOrchestratorへ差し戻す。

## feature-nameの扱い

1つの作業単位を識別する`feature-name`（kebab-case）をOrchestratorが最初に決める。
全成果物のファイル名にこの名前を使い、横断的な追跡を可能にする。

作業中のfeature-nameは`.claude/state/current-feature`に記録する（Hookがこの値を
使って成果物の有無を検証する。詳細は[document-policy.md](./document-policy.md)）。

## 完了条件

Orchestratorは以下をすべて確認してから「完了」とユーザーへ報告する。

- 要求 → 設計 → 実装計画 → 実装 → 試験 の間に矛盾がない
- L2/L3で必要な成果物が存在し、必須セクションが埋まっている
- `pnpm lint` / `pnpm type-check` / `pnpm test`（Vitest。全層導入済み — 2026-07-01 PR #21）が通っている
- スコープ外の変更が混入していない
- L2/L3の新規review packetがcurrentで、open `BLOCK`と高影響の未検証が0
- Gate Bへ渡す人間項目が3件以下で、各項目に推奨と証拠参照がある
- 人間引き渡し対象では
  `node .claude/scripts/review-readiness.mjs handoff-check --feature <feature>`が成功し、
  PR/チャット要約は`handoff-blurb`を使う（承認語禁止）
- ユーザー確認が必要な判断（下記）が解決済み

## ユーザーへ確認すべき条件

以下に該当する場合は、実装を進める前にユーザーへ確認する。

- アーキテクチャ・ドメインモデル・DBスキーマに関わる設計判断
- 新規ファイルの作成、既存ファイルの削除
- 依頼スコープを超える変更が必要になったとき
- 後方互換性・データ移行が絡むとき
- 複数の妥当な設計案があり、トレードオフの選択が必要なとき

確認時は個別の思いつきを逐次送らず、Gate Aの質問として最大3件へまとめる。ただし安全上の
停止条件や新しい権限要求は、件数を理由に遅らせない。

## セッション跨ぎの復旧（強制中断・計画分割）

usageリミット・分類器障害・ユーザー都合などでセッションが途中終了した場合、
**次セッションは経験で再発明せず、次のチェックリストで復元する**
（出典: shopping-list-screens事象1・7 / harness-post-020-audit事象3）。

### 共通の復旧の型

1. **直近の日次ログを読む** — `logs/`の最新（または対象日）の
   「今日のタスク」「やったこと」「次回やること」から、完了フェーズと残工程を特定する。
2. **リモートの成果を確認する** — `git fetch`のうえ`git ls-remote --heads origin`等で、
   feature名を含むブランチと最新コミットを確認する（エフェメラル環境ではローカルだけでは足りない）。
3. **継続ブランチを明示選択する** — 前セッションの`feature/*`と、新セッションが採番した
   `claude/*`等が並存しうる。どちらで続けるかを決めてから作業を再開する
   （黙って別ブランチに積み上げない。PR集約先の二重化防止）。
4. **未完了工程だけを再開する** — ログとリモート成果を突き合わせ、済んだ工程はやり直さない。

### 中断理由ごとの分岐

| 中断理由                    | 追加でやること                                                        |
| --------------------------- | --------------------------------------------------------------------- |
| usageリミット等の強制終了  | チェックポイントコミットがリモートにある前提。無い工程だけ再実行      |
| 計画的なセッション分割      | ログの「次回やること」をkickoffのタスク案の起点にする（従来どおり） |
| 分類器障害・Hook誤ブロック | 復旧後、期待成果物の有無で冪等判定してから再委譲（二重起動防止）      |

kickoff-sessionは手順に「強制中断からの再開か」を確認する項を持つ。
close-sessionは強制終了が近いと判断したとき、フェーズ境界のチェックポイントコミットと
「次回やること」の具体化を優先する。
