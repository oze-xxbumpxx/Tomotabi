# 改善候補: delegation-test-path-mismatch

> 委譲ループの軽量サイクル（`docs/claude-code/improvement-cycle.md`）で起票。
> `delegation.mjs summary` の昇格候補から作った。reflection-agent は通していない。

- **task-id**: delegation-test-path-mismatch
- **作成日**: 2026-09-27
- **対象タスク概要**: Devin への委譲のレビューで出た `test-path-mismatch` の指摘（異なる Issue で 3 件 = 閾値に到達）
- **関連成果物**: `docs/claude-code/improvements/delegations/31.yml`・`37.yml`・`59.yml` / `docs/designs/devin-delegation-loop.md`

## 観測した事象

### 事象 1: テストが本番の経路を通らずに合格する

- **種類**: レビュー指摘
- **観測した事象**: テストは通るが、確かめたい経路を通っていなかった。
  - #31（PR #35）: ログの試験を素の HTTP サーバーで行い、Nest の例外処理の経路を通っていなかった（must）。
  - #37（PR #39）: HTTP テストのアプリ生成が本番と違い、`bodyParser: false` になっていなかった（nit）。
  - #59（PR #64）: `router.replace` をモックしたため、クエリを消したあとの再描画（`hasError=false`）でエラー文が残るかを確かめていなかった（must）。
- **発生回数**: 異なる委譲で 3 件（#31・#37・#59）。いずれも Claude Code のレビューで見つかり、マージ前に直った。
- **原因仮説**: Devin はテストを「項目名に対応する assert が通る」ことで完了とみなし、本番の組み立てや、モックの先で起きる状態変化まで進めることを前提にしていない。
  `devin-workflow` にも Issue にも、この観点の指示が無かった。
- **改善案**: `devin-workflow` §2 に 1 行足す（本番と同じ組み立てで、テスト項目の経路を最後まで通す。HTTP は `configure-app`、モックの先の再描画は `rerender` 等で確かめる）。
  HTTP と画面の両方で出ており、どの委譲にも効く予防なので、`review-devin-pr` の「既知の指摘」の表には二重に書かない。
- **変更対象**: Skill（`.agents/skills/devin-workflow/SKILL.md` §2）
- **想定される副作用**: 指示が 1 行増える。モックを避けて外部通信するテストに振れないよう、「組み立てを本番と同じにする」「モックの先の状態まで進める」と具体的に書いた。
- **評価方法**: 軽量サイクルの事後評価。昇格後の 3 委譲で `test-path-mismatch` が 0 件ならよし（`delegation.mjs summary`）。再発したらこのファイルに追記して見直す。
- **昇格判定**: 昇格条件を満たす（異なる Issue で 3 件）

## 変更差分

```diff
 ## 2. 実装
 ...
+- テストは本番と同じ組み立てで、Issue のテスト項目の経路を最後まで通す。HTTP は本番と同じ `configure-app` でアプリを作る（素の HTTP サーバーや別の `bodyParser` 設定にしない）。モックした呼び出し（例: `router.replace`）の先で起きること（再描画など）が項目に含まれるなら、`rerender` などでその状態まで進めて確かめる。
 - 依頼の範囲外のリファクタリングはしない。気づいたことは PR の説明に書く。
```

レビュー側（`review-devin-pr` の「レビュー」4）は 3 件とも見つけているので変えない。

## ロールバック方法

`devin-workflow` §2 の上の 1 行を消す。

## まとめ

- 改善候補として起票したもの（→ backlog に追記した ID）: IMP-2026-002
- Memory に留めたもの（昇格せず・再発監視）: なし

## 事後評価（2026-09-29 追記）

IMP-2026-002 の適用（PR #66、2026-09-27）の後の委譲で、2 件再発した。

- #69（PR #70）: D-09 の DDL のテストが、表が無い（42P01）ときにも合格する。
- #78（PR #79）: P-10 に同時刻の予定が無く、並びのタイブレークの経路を通っていない。

どちらも「本番と違う組み立て」ではなく「確かめたい処理を壊しても落ちない」形で、追加した 1 行（組み立てを本番と同じにする）では防げない種類だった。
予防は IMP-2026-003（`candidates/delegation-missing-test.md`）の 1 行で扱う。IMP-2026-003 の昇格後の 3 委譲で、両方の category を見る。
