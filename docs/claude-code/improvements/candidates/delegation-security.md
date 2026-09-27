# 改善候補: delegation-security

> 委譲ループの軽量サイクル（`docs/claude-code/improvement-cycle.md`）で起票。
> `delegation.mjs summary` の昇格候補から作った。reflection-agent は通していない。

- **task-id**: delegation-security
- **作成日**: 2026-09-27
- **対象タスク概要**: Devin への委譲のレビューで出た `security` の指摘（異なる Issue で 2 件 = 閾値に到達）
- **関連成果物**: `docs/claude-code/improvements/delegations/31.yml`・`44.yml` / `docs/designs/devin-delegation-loop.md`

## 観測した事象

### 事象 1: 例外の中身（秘密）がログ・出力に出る

- **種類**: レビュー指摘
- **観測した事象**: 例外の `message` に入っていた秘密（接続先の URL・トークン）が、ログや出力にそのまま出る実装だった。
  どちらも Claude Code のレビューで見つかり、マージ前に直った。詳細・再現手順は記録の方針どおり書かない（公開リポジトリのため）。
- **発生回数**: 異なる委譲で 2 件（#31 → PR #35、#44 → PR #46）。#44 の後続 #48 では、漏れの確かめ方の弱さ（`JSON.stringify` が `message` を含まない）も `nit` で出た。
- **対象タスク**: delegations/31.yml・44.yml・48.yml
- **原因仮説**: Devin は外部ライブラリの例外を「エラーとして出す」ことを優先し、例外の中身に秘密が入る可能性を前提にしていない。
  Issue にも `devin-workflow` にも、この観点の指示が無かった。
- **改善案**: `devin-workflow` §2 に 1 行足す（例外の `message` をそのまま出さない・許可した項目だけ出す・実際に出た文字列をテストで確かめる）。
  どの委譲にも効く予防なので、委譲用の Issue の「既知の指摘」（`docs/designs/devin-delegation-status.md`）には二重に書かない。
- **変更対象**: Skill（`.agents/skills/devin-workflow/SKILL.md` §2）
- **想定される副作用**: 指示が 1 行増える。例外を握りつぶして原因が分からなくなる方向に振れないよう、「種類やコードは出す」と書いた。
- **評価方法**: evals は Tomotabi 用が無いため、軽量サイクルの事後評価を使う。昇格後、認証・ログ・外部入力を触る委譲 3 件で
  `security` が 0 件ならよし（`delegation.mjs summary`）。再発したらこのファイルに追記して見直す。
- **昇格判定**: 昇格条件を満たす（`security` の閾値 2 件。memory-policy の「重大な試験不具合」に当たる）

## 変更差分

```diff
 ## 2. 実装
 ...
+- 例外（DB ドライバー・外部ライブラリ）の `message` には、接続先の URL やトークンが入っていることがある。ログ・標準出力・API の応答にそのまま出さず、許可した項目（種類やコード）だけを出す。テストでは、実際に出た文字列に秘密が無いことを確かめる（`JSON.stringify(error)` は `message` を含まないため、それだけでは確かめられない）。
 - 依頼の範囲外のリファクタリングはしない。気づいたことは PR の説明に書く。
```

レビュー側（`review-devin-pr` の「レビュー」5）は 2 件とも見つけているので変えない。

## ロールバック方法

`devin-workflow` §2 の上の 1 行を消す。

## まとめ

- 改善候補として起票したもの（→ backlog に追記した ID）: IMP-2026-001
- Memory に留めたもの（昇格せず・再発監視）: なし
