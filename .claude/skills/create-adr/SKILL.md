---
name: create-adr
description: >
  アーキテクチャ決定記録（ADR）を docs/decisions/ADR-<番号>-<タイトル>.md に作成する手順と
  テンプレート。Level 3 の重要な設計判断（採用案と非採用案・後方互換・移行）を追跡可能に残す。
---

# ADR 作成スキル

重要な設計判断を後から追跡できるよう、ADR（Architecture Decision Record）を
`docs/decisions/ADR-<番号>-<タイトル>.md` に残すための手順と雛形。主に Level 3 で使う。

## いつ作るか

- アーキテクチャ・ドメインモデル・DB スキーマ・契約・外部連携など、後から「なぜこうしたか」を
  説明する必要がある判断をしたとき。
- 複数の妥当な案からトレードオフで 1 つを選んだとき。

## 採番

- 番号はプロジェクト全体で一意。Tomotabi に既存 ADR は無いので
  **`docs/decisions/ADR-0001-<タイトル>.md` から開始**する。
- 以降は `docs/decisions/` の最大番号 +1。`docs/` 直下の配布元 ADR は引き継がない。

## テンプレート

```markdown
# ADR-<番号>: <タイトル>

- Status: Proposed | Accepted | Superseded by ADR-XXXX | Deprecated
- Date: YYYY-MM-DD
- 関連 feature: <feature-name>

## Context（背景・なぜ判断が必要か）

## Decision（採用した決定）

## Alternatives（検討した非採用案と却下理由）

## Consequences（良い影響・悪い影響・残るリスク）

## Migration（移行が必要な場合の手順。不要なら「対象外」）

## Rollback（決定を戻す場合の手順）

## References（設計書・要件・関連 ADR・外部資料へのリンク）
```

## 完了条件

- Status が設定されている。
- Alternatives に非採用案と却下理由がある（「検討した」ことを残す）。
- Migration / Rollback が判断されている（不要なら「対象外」と明記）。

## 良い例

Tomotabi に ADR はまだ無い。初めて書くときは本スキルのテンプレートを使い、
Alternatives に非採用案と却下理由を残す。
（配布元 Cookpit では ADR に選択肢 A/B/C と採択理由があり、後続設計が「ADR-xxx 準拠」と
参照できた。その型を踏襲する。）

## 注意

- ADR は判断の記録であり、Skill や Rule への昇格とは別。恒久ルール化は
  [memory-policy.md](../../../docs/claude-code/memory-policy.md) の昇格条件に従う。
