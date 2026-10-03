# Tomotabi開発ルール

Claude CodeとCodexは、このリポジトリの同じハーネス・成果物・ログを利用する。

## 現在の状態

- M0（開発基盤）まで。旅行・認証・精算などの業務機能は未実装。
- 採用スタック: Node 22.x、npm workspaces、`apps/web`（Next.js App Router）、`apps/api`（NestJSモジュラーモノリス＋6区分）、`packages/contracts`（公開API契約のみ）、Drizzle＋pg、Vitest。詳細はREADMEと`docs/decisions/ADR-0001-m0-workspace-and-stack.md`。
- スタック固有の規約は、採用済み技術にだけ適用する。存在しない設計書・コマンド・レビュー結果をあるものとして扱わない。
- ハーネスの`run-quality-gates.sh`はロックファイルからパッケージマネージャーを検出して実行する（本リポジトリではnpm）。アプリの品質確認は`npm run lint` / `npm run type-check` / `npm test` / `npm run build`を使う。

## 現在有効なハーネス機能 / 休眠

**現行（今すぐ使う）**

- 作業分担、変更レベル分類、日次ログ、危険操作ガード、実在する品質コマンド、ハーネス試験（日常は`bash .claude/scripts/run-quality-gates.sh`。全件は`node --test .claude/tests/*.test.mjs`）。

**休眠（アプリのL2 / L3が複数回回るまで必須にしない）**

- `review-readiness` / Gate B / structured packetのhard stop（`docs/reviews/README.md`は未作成）。
- 改善サイクル3 Agent（reflection / manager / evaluator）とevals。evalsは配布元ドメイン向けで、Tomotabi用ケースは未整備。
- Codex委譲ルート（`create-codex-brief`等は未導入）。実装はimplementer経路を使う。

層別ルール（`.claude/rules/domain-layer.md`等）や`docs/01`〜`07`は未作成。参照せず、必要になったときに新設する。

## 作業分担（AI駆動開発）

Tomotabiは **AI駆動開発を主とする**。AIが実装し、ユーザーは要件提示・設計判断・レビュー・マージを担う。

- 既定でAIが設計案の提示から実装・テスト・PR作成まで行う。ユーザーは要件提示・設計判断・レビュー・マージを担う。
- L2 / L3では設計書（`docs/designs/`）をユーザーが承認してから実装に入る。L0 / L1は承認なしで進める。
- 技術スタック・アーキテクチャなどADR級の決定はAIが候補と比較を示し、決定はユーザーが行う。
- `main`へ直接コミットしない。変更は作業ブランチ → PR。破壊的操作（履歴改変・データ削除・本番操作）は事前確認する。
- 実装完了の報告には「何を・なぜそう設計したか・別解との比較」を含め、ユーザーが読んで学べる形にする。L2 / L3は必須、L1は3行以内の要約、L0は省略する。
- ユーザーへの説明（チャット・PRの説明・報告）では、段階の番号（M3など）・画面番号（v3の14bなど）・試験の観点ID（T-01など）だけで物事を指さない。プロジェクトの用語（「支払い・精算の中核」「受け渡しの確認」「同じ要求の再送で二重に作られない」など、基本設計・詳細設計・v3の言葉）で書き、番号は必要なら括弧で添える。用語は`docs/glossary.md`に置き、正本に無い言葉で説明に要るものは足してよい。

人が止まって判断するゲートは次のとおり。AIはゲートの手前まで進めてよい。ゲートを越える判断はユーザーが行う。

| ゲート | いつ | 誰が決めるか |
| --- | --- | --- |
| L2 / L3の設計承認 | 実装開始前 | ユーザー |
| ADR級の決定（スタック・アーキテクチャ・後方互換） | 採用前 | ユーザー（AIは比較まで） |
| PRのマージ | 品質確認後 | ユーザー |
| 破壊的操作 | 実行前 | ユーザー |

## 作業の進め方

1. 作業開始時に`git status`と`logs/`の最新ログを読み、実装済み・未完了を確認する。
2. `.claude/skills/classify-change/SKILL.md`を参照して変更規模を判断する。判定結果に **ユーザー承認: 必要 / 不要** を含める。必要な設計・計画・検証・レビューは`docs/claude-code/`と該当スキルを参照する。L2 / L3の要件定義書・設計書は、書く前に`.claude/skills/ask-questions/SKILL.md`の手順で問いを出し、ユーザーの答えを受けてから書く。
3. 小さな修正は直接進める。ユーザーが既に依頼した範囲のファイル追加や通常作業で再承認を求めない。
4. 品質コマンドは実在するものだけ実行し、未導入のゲートは`unknown`と報告する。ハーネス自身のテストは`node --test .claude/tests/*.test.mjs`。
5. 人が読む文章（報告・ログ・docs・Issue・PR・コメント）は`.claude/rules/writing-style.md`の書き方にする。このルールは文章スキル`shizen-nihongo`の要点を写したもので、Claude Codeは書くときにスキルも読み込む。
6. 終了時は変更・検証・未完了事項を`logs/YYYY-MM-DD.md`に記録する。他方のツールが残した変更を上書きせず、同じファイルを同時編集しない。Devinは`logs/`を編集せずPRの説明に書く（並行PRの衝突を避けるため。Devinの作業はClaude Codeが委譲の記録からログに書く）。
7. `main`へ直接コミットしない。変更は作業ブランチ → PR。ハーネス構成（`.claude/` / `AGENTS.md`）の変更はPRで重点レビューする。

## ツールごとの入口

- Claude Code: `CLAUDE.md`、`.claude/skills/`、`.claude/agents/`、`.claude/settings.json`のフックを使う。
- Codex: 本ファイルと`.agents/skills/`から共通スキルを読む。`.claude/agents/`は役割の参考資料であり、Codexのエージェント登録ではない。Claude CodeのフックはCodexでは自動実行されない。
- Codexでハーネスの状態を扱うコマンドには`HARNESS_NAMESPACE=tomotabi-harness`を付け、リポジトリルートで実行する。Claude Codeには同じ値をsettingsのenvで設定している。
- スキルから参照されるCookpit専用文書・専用スキルが無い場合は、本ファイルと実際の構成を使う。未採用の技術や架空の成果物を補わない。
- CodexにはClaude Codeのフック（危険操作の遮断・成果物チェック）が無い。代替として、本ファイルの作業分担・ブランチ運用・破壊的操作の事前確認を守る。履歴改変・データ削除・本番操作は、ユーザー確認なしに実行しない。
- Devin: 本ファイルと`.agents/skills/devin-workflow/SKILL.md`（背景は`docs/devin-setup.md`）を使う。担当はIssue起点のL0 / L1とPRレビュー。L2 / L3は設計承認後だけ。ブランチは`devin/<内容>`を使い、他ツールのブランチにpushしない。Claude Codeのフックは動かないため、Codexと同じく破壊的操作の事前確認を守る。
- Devinの起動は、既定でClaude CodeがローカルのDevin CLI（SWE-2。effortは難易度で選ぶ）で行う。クラウドはユーザーが出先から指示したときだけ使う。手順は`.claude/skills/review-devin-pr/SKILL.md`。
- DevinのPRはClaude Codeがレビューし、`must`の指摘（と同じ回の`nit`）をPRに自動で投稿して、Devinの修正を再レビューする（自動の投稿は2回まで。超えたらユーザーに渡す）。セキュリティ指摘と設計判断が要る指摘は投稿せず、ユーザーに渡す。委譲ごとの記録は`docs/claude-code/improvements/delegations/`。手順は`.claude/skills/review-devin-pr/SKILL.md`。
- Issueに紐づかないDevinのPR（知見・スキル・blueprintを自分から出したもの）も、Claude Codeが見つけて同じ手順でレビューする（`review-devin-pr`の「IssueなしPR」）。

導入元・更新時の注意は`docs/harness-setup.md`を参照。
