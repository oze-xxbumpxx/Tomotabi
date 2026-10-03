# Devinの導入

2026-09-24にDevinを契約した。Tomotabiでは、Claude Code・Codex・Cursorと同じルール（`AGENTS.md`）に従う、非同期でPRを出す担当として使う。

## 役割

| 担当        | 任せる作業                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------- |
| Devin       | Issue / Linear起点のL0 / L1（テスト追加、lint修正、文言修正、依存の小さな更新）と、PRのレビュー |
| Claude Code | L2 / L3の設計・実装計画・実装、ハーネス（`.claude/`）の変更                                        |

- L2 / L3をDevinに任せるのは、`docs/designs/`の設計書をユーザーが承認したあとだけにする。
- 同じブランチを他のツールと同時に編集しない。Devinには専用のブランチ（`devin/<内容>`）を使わせる。
- マージはユーザーが行う。DevinのPRもCI（`quality` / `build` / `harness` / `api-db`）が通ってからマージする。

## Devinにルールを届ける方法

DevinのKnowledgeはSkillsに移行し、画面からKnowledgeを登録する入口は無くなった（2026-09時点）。Tomotabiでは画面に登録せず、リポジトリのファイルで届ける。レビューでき、`AGENTS.md`と食い違えば差分で気づけるため。

| Devinが自動で読むもの                   | 内容                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `AGENTS.md` / `CLAUDE.md`                | 全ツール共通のルール                                                     |
| `.agents/skills/*/SKILL.md`              | Codexと共有する日常のスキル（`.claude/skills/`へのシンボリックリンク） |
| `.agents/skills/devin-workflow/SKILL.md` | Devinだけの手順（ブランチ名、品質確認、やってはいけないこと、作業ログ） |

`devin-workflow`はDevin専用のため`.claude/skills/`には置かず、`.agents/skills/`に実体を置く。Codexにも見えるが、説明に「Devinのセッションでだけ使う」と書いて区別する。

## Devinに無い仕組み

Claude Codeのフック（危険操作の遮断・成果物チェック）はDevinでは動かない。Codexと同じく、`devin-workflow`スキルの「やってはいけないこと」で指示して代わりにする。守られたかどうかはPRのレビューで確かめる。

Devinは`.mdc`のルールも読むため、Cursor用の`.cursor/rules/pstack-default.mdc`も取り込まれることがある。Devinにはpstackが無いので、スキルでは従わないよう書いている。画面のRules一覧にpstackが出ていたら無効にする。

## 作業環境（blueprint）

Devinの作業環境は`.devin/blueprint.yaml`で定める（画面で設定する旧方式は2026-07に廃止）。リポジトリで管理するので、変えるときもPRでレビューする。

| 節            | Tomotabiでの内容                                                                                        | いつ動くか                                         |
| ------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `initialize`  | Node 22が無ければnodejs.orgの公式配布物をチェックサムで確かめて入れる。最後に22でなければ失敗させる | 環境を一から作るとき。結果はスナップショットに残る |
| `maintenance` | Node 22であることを確かめてから`npm ci`（CIと同じ）                                                   | スナップショットを作り直すたび                     |
| `knowledge`   | lint / type-check / test / build / api:check・db:check / devの各コマンドと注意                          | 実行されない。Devinへの参照情報                   |

- `DATABASE_URL`は空のままでよい（APIはin-memoryで動く）。`.env`に本番の値を入れない。
- `npm run test:api-db`はDocker（Testcontainers）が必要。使えない場合はCIの`api-db`ジョブで確かめる。
- 規約や作業手順はblueprintに書かず、`AGENTS.md`と`devin-workflow`スキルに置く。blueprintの`knowledge`は環境に結びついた短いコマンドの参照だけにする。

## 実行場所（2026-09-26）

Devinは、**既定でローカル**（手元のMacのDevin CLI）で動かす。ユーザーが出先から指示したときだけクラウドを使う。起動と修正の手順は`.claude/skills/review-devin-pr/SKILL.md`。

| | ローカル（既定） | クラウド（指示時のみ） |
| --- | --- | --- |
| 起動 | 専用クローン`/Users/siro/個人開発/devin-work/tomotabi`で`devin --model swe-2-<effort> --permission-mode dangerous -p …` | `devin --cloud -p …` |
| モデル | `--model`で依頼ごとにSWE-2のeffortを選べる | `--model`は無視される。Devin Webの「セッションエージェント」の既定（SWE-2 High） |
| PRの監視 | する。プロンプトで`devin-workflow` §4.5を指示すると、PRを出したあともコメントとCIを5分ごとに見て直す。セッションが終わっていたら、直しは新しいローカルセッションで頼む（`devin -c`は起動しなかった） | PRのコメントとCIの失敗に自動で対応する |
| 進み具合の見方 | 出力を状態ディレクトリの`devin-logs/issue-<n>.log`にteeし、見張り画面（`.claude/scripts/devin-watch.mjs`。`--install`で`~/.local/state/tomotabi-harness/bin/devin-watch`にリンク）をターミナルで開く。実行中のコマンド・変更中のファイル・PRとCI・最近の発言を5秒ごとに出す | Devin Webのセッション画面 |
| 注意 | 同じクローンで2つ同時に動かさない。`--sandbox`を付けると途中で止まる。書き込みは強制ではなくプロンプトでクローン内に限る | Macを閉じても進む |

- 専用クローンにしたのは、Devinのフォルダ信頼（初回だけ`devin`を対話で起動して許可）を1回で済ませるため。worktreeは`.git`が元のリポジトリ側にあるため使わない。
- クラウドで作業したセッションは、学んだことをスキルやblueprintに残すPRを自分から出すことがある（#53・#54）。Issueに紐づかないが、Claude Codeが自動でレビューする（委譲中のセッションは`wait-for-devin-pr.mjs`、それ以外はセッション開始時のフック`delegation-status.mjs`で見つける）。手順は`review-devin-pr`の「IssueなしPR」。

## 確認済みのこと（2026-09-25）

Devinのセッションで「使えるスキルの一覧」を尋ねて確かめた。

- `.agents/skills/`のシンボリックリンク先（`.claude/skills/`）も読めている。共有スキルと`devin-workflow`が一覧に出た。
- Devinには、組み込みのスキル（`managing-playbooks`・`managing-automations`・`managing-child-sessions`など）もある。
- Devinに接続した他のリポジトリ（Cookpit）のスキルも一覧に出る。その中にはTomotabiに無いスキル（`create-codex-brief`・`review-codex-implementation`・`manual-browser-verify`）がある。Tomotabiの作業で使わないよう、`devin-workflow`の「やってはいけないこと」に書いた。DevinのSettings → Environmentのリポジトリ欄でcookpitもIncludedになっているため。

Devinの画面（Settings → Environment → Snapshots）のビルドログで確かめた。

- blueprintが読み込まれ（`1 blueprint changed`）、`maintenance`のNode 22の確認を通って`npm ci`が成功した（853パッケージ）。Health Checkも成功した。
- `npm ci`は`16 vulnerabilities (13 moderate, 3 high)`を報告した。既存の依存によるもので、未対応。

GitHub側の設定。

- mainにRuleset（`protect-main`）を設定した。PR必須（承認0）、CIの`quality`・`build`・`api-db`の成功が必須、force pushと削除を禁止。バイパスは無し。Devinを含め、どのツールもmainへ直接pushできない。

## 未確認のこと

- DevinのVMでDocker（`npm run test:api-db`）が動くか。
