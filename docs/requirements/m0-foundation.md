# 要件定義: m0-foundation

- task-id / 変更レベル: M0 / L3
- 作成日: 2026-09-11

## 背景

旅行Webアプリの実装は未着手。M-1でフロントFeature-basedとバック6区分が合意済み。詳細設計01〜11を正本とし、まず開発基盤と依存の互換性を検証する。

## 目的

Next.js / NestJS / TypeScriptのworkspace、層間import制約、IF経由のDI、Vitest / Supertest / Testcontainers、GitHub Actionsのquality / build / 最小api-dbを動く単位で用意する。架空の検証例を実機能の完成と数えない。

## ユーザー要求（原文の要約）

`docs/旅行アプリ設計 3/Cursor_M0着手依頼.md`に従い、既存成果物を上書きせずM0を実施する。sql/00は本番migrationではない。認証・金銭・通知の本実装、Vercel / Neon公開、有料契約、公開用テストログイン裏口は含めない。

## 機能要件

| ID | 内容 |
|---|---|
| N-01 | monorepo（apps/web, apps/api, packages/contracts）と最小ディレクトリを用意する |
| N-02 | TypeScript・lint・import境界・Node 22.x・lockfile・開発手順を設定する |
| N-03 | NestのIF / DIとService / Domainの接続が成立する最小例をテストする |
| N-04 | Nextの画面入口・Client境界とweb / apiの本番buildを検証する |
| N-05 | Vitest（web / api）、@nestjs/testing、Supertest、Testcontainersの基盤を作る |
| N-06 | GitHub Actionsでquality / build / 最小api-dbを動かす。未作成のE2Eを成功扱いにしない |
| N-07 | 実行コマンド、実バージョン、検証結果、残課題をREADME等へ記録する |

## 非機能要件（性能・セキュリティ・可用性など。無ければ「対象外」）

- Node 22.x。本番秘密をCIに渡さない。無料枠条件（詳細設計08）を維持する。
- 性能目標・可用性SLAは対象外（M0は基盤検証）。

## 正常系

| ID | 内容 |
|---|---|
| N-10 | DomainのProbeCountが非負整数だけを受け入れる |
| N-11 | ServiceがIF経由で加算し、上限を超えない |
| N-12 | UseCaseがUnitOfWork IF経由で取得→計算→保存する |
| N-13 | Nest ModuleがIFと実装を配線し、HTTPでincrement / getできる |
| N-14 | NextのServer Component入口からClient Componentを描画できる |
| N-15 | web / apiの本番buildが成功する |

## 異常系

| ID | 内容 |
|---|---|
| E-01 | 負数・非整数のProbeCountを拒否する |
| E-02 | 加算stepが1未満、または上限超過を拒否する |
| E-03 | Dockerが無い環境でTestcontainersをPGliteに置換して合格にしない |
| E-04 | webからapps/api / drizzle-orm / pgをimportするとlintが失敗する |
| E-05 | Domain / UseCase / Adapterが禁止依存をimportするとlintが失敗する |

## 境界条件（null・空・上限/下限・権限境界）

| ID | 内容 |
|---|---|
| B-01 | ProbeCountの0は許可、上限1,000,000の次の加算は拒否 |
| B-02 | DATABASE_URL未設定時はin-memory実装でAPIを起動できる（実DB検証の代替ではない） |
| B-03 | 認証・認可は未実装。foundation経路はM0検証専用であり本番公開前に閉じる |

## 前提

- M-1の構成判断は完了している（詳細設計11）。
- ローカルNodeは22.x。TestcontainersはDockerが必要。

## 制約

- 既存ハーネス（`.claude/`）と設計資料を上書きしない。
- `main`へ直接コミットしない。
- sql/00_validation_prerequisites.sqlを本番migrationとして使わない。
- 公開用のテストログイン裏口を作らない。

## 対象範囲

開発基盤、互換性検証用のfoundation最小例、CI骨組み、記録。

## 対象外

旅行・予定・支払い・精算・認証・通知の本実装。Playwright E2Eの有効化。Vercel / Neonの作成と公開。Better Auth標準表。本番GRANT。

## 後方互換性・データ移行（該当なければ「対象外」）

対象外。アプリコードは新規。既存はハーネスと設計資料のみ。

## 受け入れ条件（Definition of Doneに対応）

1. 層間依存制約がESLintで検知できる。
2. IF経由のNest DIがテストで成立する。
3. web / apiの本番buildが成功する。
4. Testcontainersで実PostgreSQLを起動・破棄できる。Dockerが無ければ未完了と報告し、PGliteへ置換しない。
5. 実依存バージョンと検証結果をREADMEに残す。

## 未決事項（誰に何を確認するか）

- パッケージマネージャはnpm workspacesをM0実装判断とした。pnpmへ変更するかはユーザー確認（ハーネスのquality-gatesはまだpnpm固定）。
- foundation経路をM1以降いつ閉じるか（公開前必須）。
