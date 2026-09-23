# 実装計画: m0-foundation

- 前提となる設計書: docs/designs/m0-foundation.md
- レベル: L3
- 実装ルート: Orchestrator（implementer）
- 判断理由: 既定。ユーザーが Cursor へ M0 実施を依頼済み。

## 変更対象ファイル

| path | なぜ変えるか |
|---|---|
| `.gitignore` | node_modules / dist / .next を除外する |
| `AGENTS.md` | スタック未決定の記述を、M0 採用後の事実に更新する |

## 新規作成ファイル

workspace 設定、apps/web、apps/api、packages/contracts、ESLint、CI、README、本ドキュメント一式。未実装機能の空クラスは作らない。

## ファイルごとの変更内容

### `.gitignore`

- 変更内容: Node / Next / テスト成果物の除外を追加する。
- 完了条件: `npm install` と `next build` の生成物が commit 対象にならない。

### `AGENTS.md`

- 変更内容: 「アプリ未実装・スタック未決定」を M0 採用内容へ更新する。
- 完了条件: 後続エージェントが Next / Nest を未採用と誤認しない。

## 実装手順

1. workspace と Node 22.x … ルート `package.json` / `.nvmrc` / lockfile / 完了条件: `engines` が 22.x。
2. 境界 lint … `eslint.config.mjs` / 完了条件: 禁止 import の fixture が失敗する。
3. contracts … wire 型と foundation OpenAPI / 完了条件: DB schema を含まない。
4. api 6 区分 … foundation モジュール / 完了条件: UseCase が実装クラスを import しない。
5. api テスト … Domain / Service / UseCase / DI / Supertest / Testcontainers / 完了条件: 単体は Docker なしで通る。db テストは Docker 必須。
6. web … app / screens / features / shared と Client 境界 / 完了条件: layout に一律 `use client` が無い。
7. build … `npm run build` / 完了条件: web と api が成功する。
8. CI … quality / build / api-db / 完了条件: e2e ジョブを成功扱いで置かない。
9. 記録 … README にコマンド・実バージョン・検証結果・残課題。

## 依存関係

contracts → api / web。単体テスト → build。api-db は Docker。CI の e2e は後続段階。

## テスト計画

docs/tests/m0-foundation.md。配置は各 workspace の `tests/`。

- api: `tests/**/*.test.ts`（db を除外）、`tests/**/*.db.test.ts` は `test:db` のみ。
- web: `tests/**/*.test.ts` / `tests/**/*.test.tsx`。

## リスク

Docker 未起動、Nest metadata と Vitest、ハーネスの pnpm 固定。

## ロールバック方法

作業ブランチを捨てる。`main` は変更しない。DB 永続化は無い（検証コンテナは破棄）。

## ドキュメント更新対象

- `README.md` 新規。
- `AGENTS.md` の現在の状態。
- `docs/decisions/ADR-0001-m0-workspace-and-stack.md`。
- 詳細設計 01〜11 は上書きしない。
