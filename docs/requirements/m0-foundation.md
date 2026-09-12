# 要件定義: m0-foundation

- task-id / 変更レベル: M0 / L3
- 作成日: 2026-09-11

## 背景

旅行Webアプリの実装は未着手。M-1 でフロント Feature-based とバック 6 区分が合意済み。詳細設計 01〜11 を正本とし、まず開発基盤と依存の互換性を検証する。

## 目的

Next.js / NestJS / TypeScript の workspace、層間 import 制約、IF 経由の DI、Vitest / Supertest / Testcontainers、GitHub Actions の quality / build / 最小 api-db を動く単位で用意する。架空の検証例を実機能の完成と数えない。

## ユーザー要求（原文の要約）

`docs/旅行アプリ設計 3/Cursor_M0着手依頼.md` に従い、既存成果物を上書きせず M0 を実施する。sql/00 は本番 migration ではない。認証・金銭・通知の本実装、Vercel / Neon 公開、有料契約、公開用テストログイン裏口は含めない。

## 機能要件

| ID | 内容 |
|---|---|
| N-01 | monorepo（apps/web, apps/api, packages/contracts）と最小ディレクトリを用意する |
| N-02 | TypeScript・lint・import 境界・Node 22.x・lockfile・開発手順を設定する |
| N-03 | Nest の IF / DI と Service / Domain の接続が成立する最小例をテストする |
| N-04 | Next の画面入口・Client 境界と web / api の本番 build を検証する |
| N-05 | Vitest（web / api）、@nestjs/testing、Supertest、Testcontainers の基盤を作る |
| N-06 | GitHub Actions で quality / build / 最小 api-db を動かす。未作成の E2E を成功扱いにしない |
| N-07 | 実行コマンド、実バージョン、検証結果、残課題を README 等へ記録する |

## 非機能要件（性能・セキュリティ・可用性など。無ければ「対象外」）

- Node 22.x。本番秘密を CI に渡さない。無料枠条件（詳細設計 08）を維持する。
- 性能目標・可用性 SLA は対象外（M0 は基盤検証）。

## 正常系

| ID | 内容 |
|---|---|
| N-10 | Domain の ProbeCount が非負整数だけを受け入れる |
| N-11 | Service が IF 経由で加算し、上限を超えない |
| N-12 | UseCase が UnitOfWork IF 経由で取得→計算→保存する |
| N-13 | Nest Module が IF と実装を配線し、HTTP で increment / get できる |
| N-14 | Next の Server Component 入口から Client Component を描画できる |
| N-15 | web / api の本番 build が成功する |

## 異常系

| ID | 内容 |
|---|---|
| E-01 | 負数・非整数の ProbeCount を拒否する |
| E-02 | 加算 step が 1 未満、または上限超過を拒否する |
| E-03 | Docker が無い環境で Testcontainers を PGlite に置換して合格にしない |
| E-04 | web から apps/api / drizzle-orm / pg を import すると lint が失敗する |
| E-05 | Domain / UseCase / Adapter が禁止依存を import すると lint が失敗する |

## 境界条件（null・空・上限/下限・権限境界）

| ID | 内容 |
|---|---|
| B-01 | ProbeCount の 0 は許可、上限 1,000,000 の次の加算は拒否 |
| B-02 | DATABASE_URL 未設定時は in-memory 実装で API を起動できる（実 DB 検証の代替ではない） |
| B-03 | 認証・認可は未実装。foundation 経路は M0 検証専用であり本番公開前に閉じる |

## 前提

- M-1 の構成判断は完了している（詳細設計 11）。
- ローカル Node は 22.x。Testcontainers は Docker が必要。

## 制約

- 既存ハーネス（`.claude/`）と設計資料を上書きしない。
- `main` へ直接コミットしない。
- sql/00_validation_prerequisites.sql を本番 migration として使わない。
- 公開用のテストログイン裏口を作らない。

## 対象範囲

開発基盤、互換性検証用の foundation 最小例、CI 骨組み、記録。

## 対象外

旅行・予定・支払い・精算・認証・通知の本実装。Playwright E2E の有効化。Vercel / Neon の作成と公開。Better Auth 標準表。本番 GRANT。

## 後方互換性・データ移行（該当なければ「対象外」）

対象外。アプリコードは新規。既存はハーネスと設計資料のみ。

## 受け入れ条件（Definition of Done に対応）

1. 層間依存制約が ESLint で検知できる。
2. IF 経由の Nest DI がテストで成立する。
3. web / api の本番 build が成功する。
4. Testcontainers で実 PostgreSQL を起動・破棄できる。Docker が無ければ未完了と報告し、PGlite へ置換しない。
5. 実依存バージョンと検証結果を README に残す。

## 未決事項（誰に何を確認するか）

- パッケージマネージャは npm workspaces を M0 実装判断とした。pnpm へ変更するかはユーザー確認（ハーネスの quality-gates はまだ pnpm 固定）。
- foundation 経路を M1 以降いつ閉じるか（公開前必須）。
