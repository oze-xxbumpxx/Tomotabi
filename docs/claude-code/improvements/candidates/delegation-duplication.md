# 改善候補: delegation-duplication

> 委譲ループの軽量サイクル（`docs/claude-code/improvement-cycle.md`）で起票。
> `delegation.mjs summary`の昇格候補から作った。reflection-agentは通していない。

- **task-id**: delegation-duplication
- **作成日**: 2026-10-08
- **対象タスク概要**: Devinへの委譲のレビューで出た`duplication`の指摘（異なるIssueで3件。nit 4）
- **関連成果物**: `delegations/`の78・117・123

## 観測した事象

- #78（PR #79）: `MAX_CAUSE_DEPTH`と`cause`をたどるループが2つのファイルにある。
- #117（PR #120）: `executeFinanceWrite`が`executePlanWrite`の写しで、共通化を見送った。
- #123（PR #124）: 向きと金額の計算が2か所にある。

- **原因仮説**: Devinは「依頼の範囲外のリファクタリングはしない」（`devin-workflow` §2）を守り、既存の関数を変えずに写した。範囲の決まりの結果で、癖ではない。
- **改善案**: ハーネスは変えない。3件ともnitで、マージを止めていない。共通化を求めると範囲の決まりと食い違う。必要なときはレビューのnitから後続のIssueにする。
- **変更対象**: なし
- **評価方法**: `summary`で次の発生を見る。同じ原因でもう1件出たら、このファイルに追記して見直す。
- **昇格判定**: 数は閾値（異なるIssueで3件）に届いたが、昇格しない。

## まとめ

- 改善候補として起票したもの（→ backlogに追記したID）: IMP-2026-009（変えない判断をまとめた行）
- Memoryに留めたもの（昇格せず・再発監視）: このファイルの事象すべて
