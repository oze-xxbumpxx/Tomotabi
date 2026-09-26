---
name: review-devin-pr
description: >
  Devin など他のエージェントが Issue から作った PR を、Claude Code がレビューし、
  指摘 → Devin の修正 → 再レビューのループを上限付きで回す手順。`gh issue create` の後に
  wait-for-pr.mjs で PR を待ち、見つかって呼び戻されたとき、または wait-for-pr-update.mjs で
  呼び戻されたときに使う。「PR ができた」「Devin の PR をレビューして」と言われたときにも使う。
  コードは直さない。must / nit の指摘は自動で PR に投稿し、security / decision はユーザーに渡す。
---

# 他エージェントの PR のレビューと修正ループ

設計: `docs/designs/devin-delegation-loop.md`。記録の形式: `docs/claude-code/improvements/delegations/README.md`。

## 委譲（Issue を渡した直後）

1. `gh issue create` の後、フック（suggest-pr-watch）が促したら、まず記録を作る:
   `node .claude/scripts/delegation.mjs init <Issue> --model <swe-2-medium|swe-2-high|swe-2-max> [--level 0-3]`。
   Devin のモデルは必ず SWE-2（`devin --cloud --model swe-2-<effort> -p …`）。自分で実装する Issue では記録も待機もしない。
2. Bash の `run_in_background` で `node .claude/scripts/wait-for-pr.mjs <Issue>` を起動する。Issue ごとに 1 本。
3. 待機中は `sleep` や `gh` の繰り返しで様子を見ない。終了すると呼び戻される。
   - 終了コード 0: 出力の `{"issue":…}` の JSON 行に PR 番号がある（最後の行とは限らない）→「レビュー」の round 0 へ
   - 終了コード 3: 時間切れ → ユーザーに伝え、再度待つかを聞く

## レビュー（round 0 は全体、round 1 以降は前回のレビュー以降の差分）

1. **状態**: `gh pr view <n> --json files,statusCheckRollup,mergeable,body,headRefOid`。CI が未完了なら、
   ci-monitor の通知か、`gh pr checks <n> --watch` を `run_in_background` で待つ（ポーリングしない）。
   round 1 以降は `gh api repos/{owner}/{repo}/compare/<前回の sha>...<今の head>` で差分を見て、
   前回の指摘が直ったかと、新しい変更に問題が無いかを見る。Devin の返信コメントも読む。
2. **範囲**: 変更ファイルが Issue の「やること」と範囲内か。範囲外のファイル、並行作業中の他 PR が作る
   はずの型・ファイルを先回りで作っていないか。本文に `Closes #<Issue>` があるか。
3. **中身**: 設計書・試験計画と突き合わせる。名前・置き場所・型・エラーコード・応答の形。
   Issue に書いた申し送り（前の PR からの持ち越し）が守られているか。
4. **テスト**: 試験計画の観点 ID がすべてあるか。テストが本当に本番と同じ組み立てで、その経路を通っているか
   （例: #35 は素の HTTP サーバーで試し Nest の例外経路を通っていなかった。#39 はテストと本番で `bodyParser` の設定が違った）。
5. **セキュリティ**（認証・ログ・外部入力を触る PR）: 迂回できないか、秘密がログや応答に出ないか、
   テスト用の仕組みが本番に混ざらないか。疑わしければ一時的な worktree で**実際に動かして再現**する。
   再現用のテストはコミットしない。worktree は `git worktree remove` で片付ける。
   Testcontainers がイメージ取得で止まるときは、空の `config.json` を置いた `DOCKER_CONFIG` を指定し、
   サンドボックス外で実行する（Docker の認証ヘルパーを避けるため）。
6. **衝突**: 並行 PR が同じファイル（`logs/` など）を触っていないか。マージ順を提案する。

## 指摘の分類

指摘ごとに severity と category（kebab-case。語彙は delegations/README.md。合うものがあれば新しく作らない）を付ける。

| severity | 意味 | 扱い |
| --- | --- | --- |
| `must` | 直さないとマージできない（設計書・試験計画との食い違い、テストが経路を通っていない、規約違反、`Closes` 漏れ） | 自動投稿 |
| `nit` | 直した方がよいがマージを止めない | `must` があれば同じコメントに入れる。`nit` だけなら投稿せず、後続 Issue の案としてユーザーに渡す |
| `security` | 迂回・秘密の漏れ・権限の不備など、公開すると悪用の手がかりになる | **投稿しない**。ユーザーに渡す |
| `decision` | 設計・範囲の判断が要る | 投稿しない。ユーザーに判断を仰ぐ |

- 認証・ログ・外部入力に関わる指摘は、まず `security` に当たるかを確かめる。**迷ったら `security`**。

## 判定と次の動き

| 状況 | verdict | 動き |
| --- | --- | --- |
| `security` がある | `escalate` | 投稿しない。「セキュリティ指摘」の手順でユーザーに渡す。他の指摘の投稿も止める |
| `decision` がある | `escalate` | 投稿しない。選択肢と推奨を付けてユーザーに渡す |
| `must` がある・round ≤ 2 | `fix` | 下の「自動投稿」→ 更新を待つ |
| `must` が残る・round 2 を超える、または前回と同じ指摘が直っていない | `escalate` | 投稿しない。モデルを上げる／Claude が直す／Issue を分ける、の案を付けてユーザーに渡す |
| `must` なし | `merge` | 「マージ可」をユーザーに伝える（`nit` は後続 Issue の案として添える）。PushNotification を送ってよい |

どの場合も、記録に追記する:
`node .claude/scripts/delegation.mjs review <Issue> --round <n> --sha <レビューした head> --verdict <merge|fix|escalate> [--posted] --finding '<severity>:<category>:<summary>' …`。
`security` の summary は自動で `(非公開)` になる。再現手順を記録やログに書かない（公開リポジトリのため）。

## 自動投稿（`must` / `nit`）

この設計の承認（2026-09-26）により、`must` と同じ回の `nit` は、ユーザーの了承を都度取らずに投稿してよい。

1. 1 回のレビューで 1 コメント。先頭に `<!-- claude-review round=<n> -->` を入れる。指摘ごとに「何が起きるか → 期待 → 直し方の案」（#35 の形）。
2. 本文に `(aside)` を入れない（Devin が対応しなくなる）。秘密・環境変数の値・ローカルのパスを書かない。
3. 範囲外の気づきは投稿しない（ユーザーに渡す）。
4. `gh pr comment <n> --body-file <file>` で投稿し、投稿時刻（`date -u +%Y-%m-%dT%H:%M:%SZ`）を控える。
5. `run_in_background` で `node .claude/scripts/wait-for-pr-update.mjs <PR> --since <投稿時刻> --sha <レビューした head>` を起動する。
   - 終了コード 0: 更新あり。`ciConclusion` が `failure` なら、Devin が CI を直している途中のことがあるので、
     `--sha <その head>` でもう一度待つ（1 回まで。続けて失敗したらユーザーに伝える）。`success` / `none` なら次の round のレビューへ
   - 終了コード 3: 時間切れ（既定 4 時間）→ ユーザーに伝える。Devin の反応（返信・コミット）が無いときは、監視が止まっている可能性も伝える
   - 終了コード 4: PR が閉じた / マージされた → 「完了」へ

## セキュリティ指摘

PR・Issue・コメント・記録のどこにも詳細を書かない。`security` の指摘があることも書かない。ユーザーに渡し、経路を決めてもらう。推奨の順:

1. 未マージ（main に入っていない）なら、Devin の新しいセッションを CLI で起動し、PR には書かずに直させる:
   `devin --cloud --model swe-2-<同じ effort> -p "<ブランチ名> に push して直す。…"`（非公開のセッション）。
2. Devin の監視が止まっているか直せないときは、Devin の作業が終わっているのを確かめてから、Claude が同じブランチに commit する。
3. main に入っている問題なら、GitHub の Security Advisory（非公開）で扱う。

修正が push されたら、`wait-for-pr-update.mjs` で待って再レビューする（round を 1 つ進める）。

## 完了（マージ・クローズの後）

1. `node .claude/scripts/delegation.mjs finalize <Issue>`（PR が見つからなければ `--pr <n>`）。
2. 記録は Devin のブランチに commit しない。その日の締め（close-session）の PR にまとめて入れる。
3. `node .claude/scripts/delegation.mjs summary` で昇格候補が出たら、`improvement-cycle.md` の
   「委譲ループの軽量サイクル」に従って候補を起票する。

## 報告

- PR ごとに「マージ可 / 手直し中（round n）/ ユーザーの判断が必要」を先に書き、根拠・再現結果・後続への申し送りを続ける。
- マージはユーザーが行う。Claude Code はマージしない。
- 衝突の解消を頼まれたら、worktree で main を取り込み、両方の記述を残して解消し、lint・型・テストを通してから push する。
  修正中のエージェントがいるブランチには、同時にコミットしない。
