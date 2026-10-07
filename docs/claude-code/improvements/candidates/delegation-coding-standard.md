# 改善候補: delegation-coding-standard

> 委譲ループの軽量サイクル（`docs/claude-code/improvement-cycle.md`）で起票。
> `delegation.mjs summary`の昇格候補から作った。reflection-agentは通していない。

- **task-id**: delegation-coding-standard
- **作成日**: 2026-10-08
- **対象タスク概要**: Devinへの委譲のレビューで出た`coding-standard`の指摘（異なるIssueで6件。must 1・nit 5・decision 1）
- **関連成果物**: `delegations/`の73・78・109・110・119・123

## 観測した事象

### 事象1: 「値なし」に`undefined`を使う（3件）

- #78（PR #79）: PATCHの未送信を`undefined`で表した（decision）。ユーザーが判断し、規約にPATCHの入力だけの例外を足した（2026-09-28）。
- #110（PR #112）: 占有の「値なし」が`undefined`で`null`と混ざる（nit）。例外を足したあと。
- #123（PR #124）: 一覧の`cursor`の値なしが`undefined`（nit）。例外を足したあと。

### 1件ずつのもの

コメントの参照先の誤り（#73）、`sequence`だけ`number`（#109）、試験の`describe`が画面番号だけ（#119）、`import type`と`import`の重複で型検査が落ちる（#123 must。PRを出す前の`type-check`を通していない）。

- **発生回数**: 事象1は異なる委譲で3件（例外を足したあとに2件）。#128以降の12委譲では0件。
- **原因仮説**: `devin-workflow`は「値なしは`null`」とだけ書き、PATCHの例外を書いていない。Devinは省略できる欄（`?:`）や`find`の結果をそのまま返し、`undefined`が混ざる。例外があることだけが伝わると、例外の範囲を広く読む。
- **改善案**: `devin-workflow` §2の規約の行に、例外の範囲と、`undefined`が混ざりやすい2つの場面を書く。
- **変更対象**: Skill（`.agents/skills/devin-workflow/SKILL.md` §2）
- **想定される副作用**: 無い（規約の言い換えで、決まりは変えない）。
- **評価方法**: 昇格後の3委譲で`coding-standard`の`undefined`の指摘が0件か。
- **昇格判定**: 事象1は昇格条件を満たす。ただし#128以降は0件なので、変えずに見続ける判断もありうる（ユーザーが決める）。

## 変更差分

```diff
-- コーディング規約は`.claude/rules/coding-standards.md`（`any`禁止、名前付きエクスポート、`import type`、値なしは`null`）。
+- コーディング規約は`.claude/rules/coding-standards.md`（`any`禁止、名前付きエクスポート、`import type`、値なしは`null`）。`undefined`を使ってよいのはPATCHの入力の「その欄を送っていない」だけ。省略できる欄（`?:`）や`find`の結果を返すときは`?? null`で`null`にそろえる。
```

## ロールバック方法

`devin-workflow` §2の行を元に戻す。

## まとめ

- 改善候補として起票したもの（→ backlogに追記したID）: IMP-2026-006
- Memoryに留めたもの（昇格せず・再発監視）: 1件ずつのもの
