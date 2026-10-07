# 改善候補: delegation-scope-creep

> 委譲ループの軽量サイクル（`docs/claude-code/improvement-cycle.md`）で起票。
> `delegation.mjs summary`の昇格候補から作った。reflection-agentは通していない。

- **task-id**: delegation-scope-creep
- **作成日**: 2026-10-08
- **対象タスク概要**: Devinへの委譲のレビューで出た`scope-creep`の指摘（異なるIssueで2件とIssueなしPRで1件。must 2・nit 1）
- **関連成果物**: `delegations/`の76・85・pr-54

## 観測した事象

- #76（PR #77）: buildの生成物`apps/web/next-env.d.ts`の変更が入っていた（nit）。
- #85（PR #87）: v3の画面一式に無い色`#b5b3ae`を`globals.css`に2か所足した（must）。
- PR #54（Issueなし）: blueprintの日本語の説明コメントを英語の定型文に置き換えた（must）。

- **原因仮説**: 3件の原因が違う（生成物の混入、v3に無い値、目的外の書き換え）。
- **改善案**: ハーネスは変えない。最後の発生は#85（2026-09-29）で、そのあとの約30委譲で0件。`devin-workflow`の「範囲外のリファクタリングはしない」で足りている。
- **変更対象**: なし
- **評価方法**: `summary`で次の発生を見る。同じ原因でもう1件出たら、このファイルに追記して見直す。
- **昇格判定**: 数は閾値（異なるIssueで3件）に届いたが、昇格しない。

## まとめ

- 改善候補として起票したもの（→ backlogに追記したID）: IMP-2026-009（変えない判断をまとめた行）
- Memoryに留めたもの（昇格せず・再発監視）: このファイルの事象すべて
