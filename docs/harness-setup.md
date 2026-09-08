# Tomotabi のハーネス導入記録

2026-09-08 に Cookpit の配布済みプラグインを導入した。

- 配布元: https://github.com/oze-xxbumpxx/cookpit
- 取得コミット: `c0c50d14b75893e257bb590bae03fb5b534dcfc0`
- `harness-core` / `harness-workflow` / `harness-improvement`: 各 `0.1.0`
- セットアップ順序: core → workflow → improvement。付属インストーラーで合計79ファイルを配置。
- Claude Code: Tomotabi の project scope で3層とも有効。
- Codex: ユーザー環境に3層とも登録・有効化。日常の作業用スキル15個は `.agents/skills/` の相対リンクで `.claude/skills/` を共有。

## 使い方

Tomotabi を開き、新しいセッションで「今日の作業を始めよう」「品質ゲートを回して」「今日のログを書いて」などと依頼する。
Codex のスキルが一覧に出なければ再起動する。

両ツールの共通ルールは `AGENTS.md`。Claude Code は `CLAUDE.md` から同じファイルを読む。
Claude Code のフックは `.claude/settings.json` で動作する。Codex には同じフックを登録していないため、共通スキルの手順に従って検証・ログ記録を実行する。
`.claude/agents/` の役割定義は Codex のネイティブなサブエージェント設定には変換していない。

状態を扱うコマンドはリポジトリルートで実行する。

```bash
HARNESS_NAMESPACE=tomotabi-harness node .claude/scripts/harness-run.mjs where
HARNESS_NAMESPACE=tomotabi-harness bash .claude/scripts/run-quality-gates.sh
node --test .claude/tests/*.test.mjs
```

状態の保存先は `~/.local/state/tomotabi-harness`。Claude Code には settings の env で名前空間を設定済み。
Codex で直接実行する場合は上記のように環境変数を付ける。

## 配布元との差分と更新

Claude Code 用 marketplace は配布元のままだと `owner` 不足と `policy` の未対応で登録に失敗した。
`~/.local/share/cookpit-harness-claude/` に配布物をコピーし、マーケットプレイス定義だけで owner を補い、policy と interface を除去した。プラグイン本体は同じもの。
このローカルコピーは GitHub 更新に自動追随しない。配布元が修正されたら、定義の検証後に GitHub 配布へ切り替える。
Codex は GitHub の `cookpit-harness` marketplace を直接使用している。

Tomotabi 側では次を追加・調整した。

- 共通入口 `AGENTS.md`、Claude Code 入口 `CLAUDE.md`、Codex 用の相対スキルリンク。
- TypeScript 規約を配布テンプレートの汎用部分に置換。アプリ技術は未決定であり、Cookpit の採用実績を継承しない。
- テストの Cookpit 名固定を Tomotabi の明示名前空間と一時モノレポの検証に置換。
- 並行更新テストのファイルURL変換を `fileURLToPath` に修正し、日本語パスから実行可能にした。
- 名前空間、gitignore、ログテンプレートを追加。

インストーラーは差分があるファイルを上書きせず停止する。更新時はこれらのローカル差分を比較し、必要な変更を取り込む。`--force` による一括上書きはローカル調整を消すため使用しない。
この導入作業ではコミット・push を行っていない。

## 検証結果

- 両 CLI の一覧で3プラグインすべて enabled を確認。
- ハーネス既存テスト: 88件成功、0件失敗。
- Claude Code フックの参照先と15個のスキルリンク: 全件存在。
- 状態保存先: Tomotabi 専用ディレクトリを確認。
- アプリ用の品質ゲート: package.json が無く、lint / type-check / test は unknown。ハーネステストは上記の Node コマンドで別途検証済み。
- 新しい対話セッションでのスキル選択・フック発火は、この導入セッションでは未確認。

Codex のローカルスキルとシンボリックリンクの仕様: https://learn.chatgpt.com/docs/build-skills
