# Devin の導入

2026-09-24 に Devin を契約した。Tomotabi では、Claude Code・Codex・Cursor と同じルール（`AGENTS.md`）に従う、非同期で PR を出す担当として使う。

## 役割

| 担当        | 任せる作業                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------- |
| Devin       | Issue / Linear 起点の L0 / L1（テスト追加、lint 修正、文言修正、依存の小さな更新）と、PR のレビュー |
| Claude Code | L2 / L3 の設計・実装計画・実装、ハーネス（`.claude/`）の変更                                        |

- L2 / L3 を Devin に任せるのは、`docs/designs/` の設計書をユーザーが承認したあとだけにする。
- 同じブランチを他のツールと同時に編集しない。Devin には専用のブランチ（`devin/<内容>`）を使わせる。
- マージはユーザーが行う。Devin の PR も CI（`quality` / `build` / `api-db`）が通ってからマージする。

## Devin にルールを届ける方法

Devin の Knowledge は Skills に移行し、画面から Knowledge を登録する入口は無くなった（2026-09 時点）。Tomotabi では画面に登録せず、リポジトリのファイルで届ける。レビューでき、`AGENTS.md` と食い違えば差分で気づけるため。

| Devin が自動で読むもの                   | 内容                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `AGENTS.md` / `CLAUDE.md`                | 全ツール共通のルール                                                     |
| `.agents/skills/*/SKILL.md`              | Codex と共有する日常のスキル（`.claude/skills/` へのシンボリックリンク） |
| `.agents/skills/devin-workflow/SKILL.md` | Devin だけの手順（ブランチ名、品質確認、やってはいけないこと、作業ログ） |

`devin-workflow` は Devin 専用のため `.claude/skills/` には置かず、`.agents/skills/` に実体を置く。Codex にも見えるが、説明に「Devin のセッションでだけ使う」と書いて区別する。

## Devin に無い仕組み

Claude Code のフック（危険操作の遮断・成果物チェック）は Devin では動かない。Codex と同じく、`devin-workflow` スキルの「やってはいけないこと」で指示して代わりにする。守られたかどうかは PR のレビューで確かめる。

Devin は `.mdc` のルールも読むため、Cursor 用の `.cursor/rules/pstack-default.mdc` も取り込まれることがある。Devin には pstack が無いので、スキルでは従わないよう書いている。画面の Rules 一覧に pstack が出ていたら無効にする。

## 作業環境（blueprint）

Devin の作業環境は `.devin/blueprint.yaml` で定める（画面で設定する旧方式は 2026-07 に廃止）。リポジトリで管理するので、変えるときも PR でレビューする。

| 節            | Tomotabi での内容                                                               | いつ動くか                                         |
| ------------- | ------------------------------------------------------------------------------- | -------------------------------------------------- |
| `initialize`  | nvm があれば Node 22 を入れて既定にする                                         | 環境を一から作るとき。結果はスナップショットに残る |
| `maintenance` | `npm ci`（CI と同じ）                                                           | スナップショットを作り直すたび                     |
| `knowledge`   | lint / type-check / test / build / api:check・db:check / dev の各コマンドと注意 | 実行されない。Devin への参照情報                   |

- `DATABASE_URL` は空のままでよい（API は in-memory で動く）。`.env` に本番の値を入れない。
- `npm run test:api-db` は Docker（Testcontainers）が必要。使えない場合は CI の `api-db` ジョブで確かめる。
- 規約や作業手順は blueprint に書かず、`AGENTS.md` と `devin-workflow` スキルに置く。blueprint の `knowledge` は環境に結びついた短いコマンドの参照だけにする。

## 確認済みのこと（2026-09-25）

Devin のセッションで「使えるスキルの一覧」を尋ねて確かめた。

- `.agents/skills/` のシンボリックリンク先（`.claude/skills/`）も読めている。共有スキルと `devin-workflow` が一覧に出た。
- Devin には、組み込みのスキル（`managing-playbooks`・`managing-automations`・`managing-child-sessions` など）もある。
- Devin に接続した他のリポジトリ（Cookpit）のスキルも一覧に出る。その中には Tomotabi に無いスキル（`create-codex-brief`・`review-codex-implementation`・`manual-browser-verify`）がある。Tomotabi の作業で使わないよう、`devin-workflow` の「やってはいけないこと」に書いた。

## 未確認のこと

- Devin の VM で Docker（`npm run test:api-db`）が動くか。
- blueprint で Node 22 が入り、`npm ci` が通るか（Devin の画面でビルド結果を確かめる）。ベースイメージに nvm が無い場合、`initialize` は Node を入れずに進む。
- GitHub 連携で Devin に与える権限。GitHub のブランチ保護で main への直接 push を止めておくと安全。
