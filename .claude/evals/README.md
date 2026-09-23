# Agent 回帰評価セット

Agent 構成（Agent / Skill / Rule / CLAUDE.md / Hook）を変更する前後で品質が悪化していないかを
確認するための、代表的なタスクセットと採点基準。

改善サイクルの位置づけは [docs/claude-code/improvement-cycle.md](../../docs/claude-code/improvement-cycle.md)
を参照。評価は `agent-evaluator` が実施する。

## 構成

```
.claude/evals/
├── cases/      代表タスク（実在 6 件。配布元ドメイン向けで Tomotabi では休眠）
├── rubrics/    採点基準（scoring-rubric.md）
├── baselines/  改善前（before）の基準スコアの保存先
└── results/    評価結果の保存先（<proposal-id>--<case>.md など）
```

## 使い方

1. 改善提案（`docs/claude-code/improvements/proposals/<IMP-...>.md`）の変更対象に応じ、
   manager が関連する `cases/*.md` を選ぶ。
2. `agent-evaluator` が **before（現状構成）** と **after（差分適用後の想定）** の両方で、
   各ケースを `rubrics/scoring-rubric.md` の軸で採点する。
3. 1 軸でも悪化（スコア低下・劣化指標の増加・質問/トークンの増加のみ）があれば採用しない。
4. 結果を `results/` に残し、`evaluations/<IMP-...>.md` に集約する。

## 重要

- 評価ケースは「正解の実装」ではなく「**期待される進め方と成果物**」を定義する。実コードを
  変更せずに、Agent の判断・成果物の質を測ることを目的とする。
- ケースは配布元 Cookpit の実構成に紐づいている。Tomotabi 用に書き換えるまで評価には使わない
  （AGENTS.md の休眠）。
- 評価そのものに過剰なトークンをかけない。対象ケースは提案の影響範囲に絞る。

## ケース一覧

| ファイル | 想定レベル | 主に測る軸 |
| --- | --- | --- |
| `cases/small-bug-fix.md` | L1 | 不要作業量・過剰な質問の抑制・最小修正 |
| `cases/api-field-addition.md` | L2 | 影響範囲調査・設計/契約整合・実装計画 |
| `cases/refactoring.md` | L2 | スコープ厳守・振る舞い不変・回帰観点 |
| `cases/external-service-failure.md` | L2/L3 | 異常系・冪等性・リトライ・安全性 |
| `cases/documentation-only-change.md` | L0/L1 | 過剰工程の抑制・Agent/トークン効率 |
| `cases/permission-change.md` | L3 | 安全性・ユーザー確認 |

未作成のため一覧から外したもの: `database-schema-change` / `frontend-screen-addition` /
`aws-integration-change` / `contract-validation-change`。必要になったら新設する。
