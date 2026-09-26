# 委譲の記録（Issue → Devin → PR）

Devin に渡した Issue ごとに 1 ファイル（`<Issue 番号>.yml`）を置く。並行 PR でも衝突しないよう、1 つのファイルに追記しない。
設計は `docs/designs/devin-delegation-loop.md`、使う手順は `.claude/skills/review-devin-pr/SKILL.md`。

## 作り方

手で編集せず、`.claude/scripts/delegation.mjs` を使う（形が崩れると集計で読めなくなる）。

| いつ | コマンド |
| --- | --- |
| Issue を渡したとき | `node .claude/scripts/delegation.mjs init <Issue> --model <swe-2-medium\|swe-2-high\|swe-2-max> [--runner cloud] [--level 0-3]` |
| レビューの round ごと | `node .claude/scripts/delegation.mjs review <Issue> --round <n> --sha <head> --verdict <merge\|fix\|escalate> [--posted] --finding '<severity>:<category>:<summary>' …` |
| マージ・クローズの後 | `node .claude/scripts/delegation.mjs finalize <Issue> [--pr <n>]` |
| 集計 | `node .claude/scripts/delegation.mjs summary` |

記録は Devin のブランチに commit しない。その日の締め（close-session）の PR にまとめて入れる。

## 項目

| 項目 | 書く人 | 意味 |
| --- | --- | --- |
| `issue` / `title` / `delegated_at` | init（gh） | Issue の番号・題・作成日時 |
| `agent` | init | いまは常に `devin` |
| `model` | init | `swe-2-medium` / `swe-2-high` / `swe-2-max` / `unknown`（記録を始める前の委譲） |
| `runner` | init | Devin を動かした場所。`local`（既定）/ `cloud`。項目が無い古い記録は集計で `unknown` |
| `change_level` | init | 0〜3。分からなければ `null` |
| `reviews[]` | review | round ごとの `reviewed_sha`・`verdict`（merge / fix / escalate）・`posted`（PR に投稿したか）・`findings[]` |
| `findings[]` | review | `severity`（must / nit / security / decision）・`category`・`summary` |
| `escalations` | review | `verdict: escalate` の回数（ユーザーに渡した回数） |
| `outcome` | finalize | merged / closed / open |
| `gh` | finalize | `pr`・`pr_created_at`・`merged_at`・`closed_at`・`commits`・`ci_first_pass`（PR 作成時の head の CI がすべて成功したか。チェックが無ければ `null`）・`closes_linked` |

- 手戻りの回数（round）は `posted: true` の review の数。
- **`security` の `summary` は自動で `(非公開)` になる。** このリポジトリは公開なので、再現手順・迂回の方法をどこにも書かない。

## category の語彙

集計はこの名前で数える。合うものがあれば新しく作らない。新しく作ったらこの表に足す。

| category | 例 |
| --- | --- |
| `test-path-mismatch` | テストが本番と違う組み立てで動き、本番の経路を通っていない（#35 素の HTTP サーバー、#39 `bodyParser`） |
| `error-shape` | エラー応答が設計書の形（`{ code, message }`）でない（#39） |
| `logging-gap` | 出すべきログが出ない・出してはいけない項目が出る（#39） |
| `pr-metadata` | PR 本文の不備（`Closes #N` 漏れ（#33）、品質確認の結果が無い） |
| `scope-creep` | Issue の範囲外の変更、並行 PR の担当を先回り |
| `spec-mismatch` | 名前・置き場所・型・エラーコードが設計書・試験計画と違う |
| `missing-test` | 試験計画の観点 ID に対応するテストが無い |
| `coding-standard` | `.claude/rules/coding-standards.md` の違反 |
| `security` | セキュリティの指摘（severity も `security`） |

## 昇格の閾値

`summary` は category ごとに「指摘が出た Issue の数」を数える（同じ Issue で何度出ても 1 件）。

- 異なる Issue で **3 件** → 昇格候補。`security` だけ **2 件**。
- 候補が出たら `docs/claude-code/improvement-cycle.md` の「委譲ループの軽量サイクル」に従って起票する。

## 初期データ（2026-09-26 に後から起こしたもの）

#30〜32・#37・#41 は、記録の仕組みより前の委譲。モデルは分からないため `unknown`。指摘は日次ログと PR のコメントから起こした。
#31（PR #35）の round 0 は、方針ができる前に、セキュリティ指摘を含めて公開コメントで投稿したため `posted: true` のまま残している（今後は `security` を投稿しない）。
