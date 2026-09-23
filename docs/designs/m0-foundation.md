# 設計書: m0-foundation

- ステータス: confirmed（構成は詳細設計 11 / M-1 承認済み。本ファイルは M0 実装判断の要約）
- レベル: L3
- 関連: docs/requirements/m0-foundation.md / docs/decisions/ADR-0001-m0-workspace-and-stack.md
- 正本: `docs/旅行アプリ設計 3/詳細設計/11_フロントとバックのアーキテクチャ.md` ほか 08〜10

## 背景

アプリ本体が無く、スタックも未導入だった。M0 で基盤だけを先に固定する。

## 目的

合意済みの責務分割が「図」ではなく、lint・DI・build・実 DB 起動で確認できる状態にする。

## 要件

docs/requirements/m0-foundation.md の N-01〜07 / N-10〜15 / E-01〜05 / B-01〜03。

## 対象範囲

workspace、境界 lint、foundation 最小モジュール、Next 入口、テストランナー、CI 3 ジョブ、記録。

## 対象外

業務機能、認証、E2E ジョブの成功扱い、Vercel / Neon、sql/00 の本番適用。

## 現状構成

リポジトリはハーネスと設計資料のみ。`package.json` なし。

## 変更後構成

```text
apps/web     Next.js App Router（app → screens → features → shared）
apps/api     NestJS モジュラーモノリス（Controller / UseCase / Service / Domain / Infrastructure / Adapter）
packages/contracts  公開 API の wire 型と最小 OpenAPI。DB schema・秘密・server domain は置かない
```

未実装機能の空クラスは作らない。存在する業務モジュールは foundation（互換性検証）のみ。

本プロジェクトの Adapter は IF 定義の置き場である。一般的な Ports and Adapters でいう接続実装（Adapter）は Infrastructure に置く。

## データフロー

1. ブラウザは同一 origin の `/api/*` を呼び、Next の rewrite が Nest（既定 3001）へ転送する。
2. Controller は Adapter/inbound の UseCase IF を呼ぶ。
3. Increment UseCase は UnitOfWork IF 内で Repository IF から値を取り、Service IF で計算し、保存する。
4. DATABASE_URL があるときだけ pg + Drizzle。無いときは in-memory。後者は起動確認用であり Testcontainers の代替ではない。

## API 設計

| 操作 | 経路 | 意味 |
|---|---|---|
| GET | /api/health | プロセス生存。認証なし。業務機能ではない |
| GET | /api/foundation/probes | 検証カウンタの現在値 |
| POST | /api/foundation/probes/increment | 検証カウンタを 1 加算 |

契約は `packages/contracts`。金額・旅行 ID などの業務 DTO は置かない。

## DB 設計

`infra.m0_probes` のみ。M0 検証用であり本番 migration ではない。`sql/00_validation_prerequisites.sql` は実行しない。Better Auth 標準表は M1。

## フロントエンド設計

- `app/page.tsx` は Server Component の入口。
- 画面組立は `screens/home`。
- 入力と fetch は `features/foundation` の Client Component（ui / model / api）。
- 共通 fetch は `shared/api`。Cookie 付き。業務計算は持たない。
- app 全体に `use client` を付けない。

## バックエンド設計

6 区分と依存方向は詳細設計 11 に従う。

- UseCase / Service に Nest decorator を付けない。Module の factory provider で IF と実装を結ぶ。
- Domain は Nest / DB / HTTP に依存しない。
- Service は副作用なし。上限と step の判定を担当する。
- UnitOfWork の context は `probes` Repository IF だけを渡す。生の tx は漏らさない。

## エラー処理

- (a) リトライ: M0 の DB / HTTP に自動リトライを置かない。無限リトライ禁止。
- (b) タイムアウト: Testcontainers 起動は Vitest のテストタイムアウト（120s）。アプリの pool 設定は M1。
- (c) 冪等性: increment は検証用で冪等キーを持たない。業務の Idempotency-Key は M3。
- (d) 部分失敗: UoW 内は COMMIT / ROLLBACK。通知や多段外部 I/O は対象外。
- (e) フォールバック: Docker 不在時は api-db を未完了として報告する。PGlite へ落とさない。画面は API 未起動をエラー表示する。

## ログと監視

対象外（Pino は M1。外部監視は初期導入しない）。

## セキュリティ

公開ログイン裏口なし。本番秘密を CI に渡さない。foundation 経路は検証専用。NEXT_PUBLIC_* に秘密を置かない。

## 性能

対象外。probe は互換性確認のみ。

## テスト方針

docs/tests/m0-foundation.md。層ごとに同じテストを複製しない。

## 移行とリリース

対象外。Vercel / Neon 公開は M0 に含めない。

## リスク

- ローカルに Docker が無いと実 DB 検証が未完了になる。
- ハーネスの `run-quality-gates.sh` は `pnpm` 固定のため、npm scripts を直接実行する。
- Next / Nest の minor 更新で decorator metadata や build が壊れる可能性がある。lockfile で固定する。

## 未決事項

- パッケージマネージャを pnpm に切り替えるか。
- foundation API の削除タイミング（公開前必須）。
