# 設計書: m0-foundation

- ステータス: confirmed（構成は詳細設計11 / M-1承認済み。本ファイルはM0実装判断の要約）
- レベル: L3
- 関連: docs/requirements/m0-foundation.md / docs/decisions/ADR-0001-m0-workspace-and-stack.md
- 正本: `docs/旅行アプリ設計 3/詳細設計/11_フロントとバックのアーキテクチャ.md`ほか08〜10

## 背景

アプリ本体が無く、スタックも未導入だった。M0で基盤だけを先に固定する。

## 目的

合意済みの責務分割が「図」ではなく、lint・DI・build・実DB起動で確認できる状態にする。

## 要件

docs/requirements/m0-foundation.mdのN-01〜07 / N-10〜15 / E-01〜05 / B-01〜03。

## 対象範囲

workspace、境界lint、foundation最小モジュール、Next入口、テストランナー、CI 3ジョブ、記録。

## 対象外

業務機能、認証、E2Eジョブの成功扱い、Vercel / Neon、sql/00の本番適用。

## 現状構成

リポジトリはハーネスと設計資料のみ。`package.json`なし。

## 変更後構成

```text
apps/web     Next.js App Router（app → screens → features → shared）
apps/api     NestJS モジュラーモノリス（Controller / UseCase / Service / Domain / Infrastructure / Adapter）
packages/contracts  公開 API の wire 型と最小 OpenAPI。DB schema・秘密・server domain は置かない
```

未実装機能の空クラスは作らない。存在する業務モジュールはfoundation（互換性検証）のみ。

本プロジェクトのAdapterはIF定義の置き場である。一般的なPorts and Adaptersでいう接続実装（Adapter）はInfrastructureに置く。

## データフロー

1. ブラウザは同一originの`/api/*`を呼び、NextのrewriteがNest（既定3001）へ転送する。
2. ControllerはAdapter/inboundのUseCase IFを呼ぶ。
3. Increment UseCaseはUnitOfWork IF内でRepository IFから値を取り、Service IFで計算し、保存する。
4. DATABASE_URLがあるときだけpg + Drizzle。無いときはin-memory。後者は起動確認用でありTestcontainersの代替ではない。

## API設計

| 操作 | 経路 | 意味 |
|---|---|---|
| GET | /api/health | プロセス生存。認証なし。業務機能ではない |
| GET | /api/foundation/probes | 検証カウンタの現在値 |
| POST | /api/foundation/probes/increment | 検証カウンタを1加算 |

契約は`packages/contracts`。金額・旅行IDなどの業務DTOは置かない。

## DB設計

`infra.m0_probes`のみ。M0検証用であり本番migrationではない。`sql/00_validation_prerequisites.sql`は実行しない。Better Auth標準表はM1。

## フロントエンド設計

- `app/page.tsx`はServer Componentの入口。
- 画面組立は`screens/home`。
- 入力とfetchは`features/foundation`のClient Component（ui / model / api）。
- 共通fetchは`shared/api`。Cookie付き。業務計算は持たない。
- app全体に`use client`を付けない。

## バックエンド設計

6区分と依存方向は詳細設計11に従う。

- UseCase / ServiceにNest decoratorを付けない。Moduleのfactory providerでIFと実装を結ぶ。
- DomainはNest / DB / HTTPに依存しない。
- Serviceは副作用なし。上限とstepの判定を担当する。
- UnitOfWorkのcontextは`probes` Repository IFだけを渡す。生のtxは漏らさない。

## エラー処理

- (a)リトライ: M0のDB / HTTPに自動リトライを置かない。無限リトライ禁止。
- (b)タイムアウト: Testcontainers起動はVitestのテストタイムアウト（120s）。アプリのpool設定はM1。
- (c)冪等性: incrementは検証用で冪等キーを持たない。業務のIdempotency-KeyはM3。
- (d)部分失敗: UoW内はCOMMIT / ROLLBACK。通知や多段外部I/Oは対象外。
- (e)フォールバック: Docker不在時はapi-dbを未完了として報告する。PGliteへ落とさない。画面はAPI未起動をエラー表示する。

## ログと監視

対象外（PinoはM1。外部監視は初期導入しない）。

## セキュリティ

公開ログイン裏口なし。本番秘密をCIに渡さない。foundation経路は検証専用。NEXT_PUBLIC_* に秘密を置かない。

## 性能

対象外。probeは互換性確認のみ。

## テスト方針

docs/tests/m0-foundation.md。層ごとに同じテストを複製しない。

## 移行とリリース

対象外。Vercel / Neon公開はM0に含めない。

## リスク

- ローカルにDockerが無いと実DB検証が未完了になる。
- ハーネスの`run-quality-gates.sh`は`pnpm`固定のため、npm scriptsを直接実行する。
- Next / Nestのminor更新でdecorator metadataやbuildが壊れる可能性がある。lockfileで固定する。

## 未決事項

- パッケージマネージャをpnpmに切り替えるか。
- foundation APIの削除タイミング（公開前必須）。
