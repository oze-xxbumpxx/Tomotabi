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

## Devin に無い仕組み

Claude Code のフック（危険操作の遮断・成果物チェック）は Devin では動かない。Codex と同じく、下の Knowledge で指示して代わりにする。守られたかどうかは PR のレビューで確かめる。

Devin が `AGENTS.md` を自動で読むかは、契約したプランで未確認。確実に効かせるため、要点を Knowledge にも登録する。

## Machine setup（環境）

Devin の VM に次を入れてスナップショットを保存する。

```bash
# Node 22.x（.node-version / .nvmrc と同じ）
npm ci
npm run lint
npm run type-check
npm test
npm run build
```

- `DATABASE_URL` は空のままでよい（API は in-memory で動く）。`.env` に本番の値を入れない。
- `npm run test:api-db` は Docker（Testcontainers）が必要。Devin の VM で Docker が使えるかは未確認。使えない場合は CI の `api-db` ジョブで確かめる。
- ハーネスのテストは `npm run test:harness`。

## Knowledge（登録する文面）

Devin の Knowledge に、次の項目を 1 つずつ登録する。「いつ使うか」は Knowledge のトリガー欄に、本文は内容欄に入れる。

### 1. リポジトリ共通のルール

いつ使うか: Tomotabi リポジトリで作業するとき、常に。

```text
Tomotabi のルールはリポジトリ直下の AGENTS.md にある。作業の最初に読み、従う。
- スタック: Node 22.x、npm workspaces。apps/web（Next.js App Router）、apps/api（NestJS）、packages/contracts（公開 API 契約のみ）、Drizzle + pg、Vitest。
- 前回までの作業は logs/ の最新の日付ファイルに書かれている。作業の前に読む。
- コーディング規約は .claude/rules/coding-standards.md に従う（any 禁止、名前付きエクスポート、import type、値なしは null、テストは各 workspace の tests/ に置き src/ の構造をミラーする）。
- 依頼の範囲外のリファクタリングはしない。気づいたことは PR の説明に書く。
- 存在しない設計書・コマンド・レビュー結果をあるものとして扱わない。
```

### 2. ブランチと PR

いつ使うか: ブランチを作る、コミットする、PR を作るとき。

```text
- main へ直接コミット・push しない。devin/<内容> のブランチを切り、PR を出す。
- 他のツール（Claude Code / Codex）が使っているブランチに push しない。
- 履歴の書き換え（rebase の強制 push、amend 後の force push）をしない。
- PR の説明には「何を・なぜそう設計したか・別の方法との比較」を書く。L1 は 3 行以内の要約でよい。
- PR のマージはユーザーが行う。Devin はマージしない。
```

### 3. 変更レベルと止まる場所

いつ使うか: タスクを受けたとき、着手する前。

```text
.claude/skills/classify-change/SKILL.md で変更レベル（L0〜L3）を判定し、PR の説明に「レベルと、ユーザー承認: 必要 / 不要」を書く。
- L0 / L1（文言・テスト追加・小さな修正）: そのまま実装して PR を出してよい。
- L2 / L3（複数モジュール、API・DB スキーマの変更、新機能）: docs/designs/ の設計書がユーザーに承認されていなければ、実装せずに設計案を出して止まる。
- 技術スタック・アーキテクチャの決定（ADR 級）: 候補と比較を示すところまで。決めるのはユーザー。
```

### 4. 品質確認

いつ使うか: PR を出す前、CI が失敗したとき。

```text
PR を出す前に、次をすべて通す。
  npm run lint
  npm run type-check
  npm test
  npm run build
API 契約を変えたら npm run api:check、DB スキーマを変えたら npm run db:check も通す（どちらも CI で実行される）。
ハーネス（.claude/）を変えたら npm run test:harness を通す。
.claude/scripts/run-quality-gates.sh は pnpm 固定のため使わない。
通らないテストをスキップ・無効化して CI を通さない。実行できなかったものは PR の説明に「未確認」と書く。
```

### 5. やってはいけないこと

いつ使うか: 常に。

```text
次はユーザーの確認なしに実行しない。
- データの削除、DB の migration の本番適用、本番環境への操作
- git の履歴の書き換え、ブランチの削除
- .env や秘密情報のコミット（.env.example には本番の値を書かない）
- .claude/ と AGENTS.md / CLAUDE.md の変更（ハーネスの構成。変えるなら PR で理由を書き、重点レビューを依頼する）
```

### 6. 作業ログ

いつ使うか: PR を出すとき。

```text
logs/YYYY-MM-DD.md（当日の日付）に、やったこと・検証結果・未完了を追記する。ファイルが無ければ作る。
「AI ツール活用記録」の欄に「Devin: <依頼内容と結果>」を 1 行で書く。
他のツールが同じ日のログに書いた内容を消さない。
```

## 未確認のこと

- Devin が `AGENTS.md` を自動で読むか。
- Devin の VM で Docker（`npm run test:api-db`）が動くか。
- GitHub 連携で Devin に与える権限（main への push を禁止できているか）。GitHub のブランチ保護で main への直接 push を止めておくと安全。
