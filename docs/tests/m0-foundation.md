# 試験計画: m0-foundation

- 前提となる設計書: docs/designs/m0-foundation.md
- レベル: L3

## 試験種別

- 単体: Domain / Service / UseCase（in-memory） / web component / 境界lint
- 結合: @nestjs/testing + Supertest（HTTP）
- 実DB: Testcontainers PostgreSQL（Docker必須。無ければ未完了）
- E2E: 対象外（Playwrightは未導入。成功扱いにしない）

## 単体試験観点

| # | 観点 | 前提 | 操作 | 期待結果 | 分類(正常/異常/境界) |
|---|---|---|---|---|---|
| U-01 | ProbeCount 0 | なし | `create(0)` | 値0 | 境界 |
| U-02 | ProbeCount負数 | なし | `create(-1)` | 例外 | 異常 |
| U-03 | ProbeCount非整数 | なし | `create(1.5)` | 例外 | 異常 |
| U-04 | increment +1 | count=0 | Service.increment | 1 | 正常 |
| U-05 | step不正 | count=0 | step=0 | 例外 | 異常 |
| U-06 | 上限超過 | count=1000000 | increment | 例外 | 境界 |
| U-07 | UseCaseがIFだけを使う | fake UoW / Service | execute | 保存値が +1 | 正常 |
| U-08 | webがAPI失敗を表示 | fetch拒否 | 描画 | エラー文言 | 異常 |
| U-09 | webが件数を表示 | fetch成功 | 描画 | 件数 | 正常 |
| U-10 | 禁止import | fixture | eslint | エラー | 正常（検知） |

## 結合試験観点

| # | 観点 | 前提 | 操作 | 期待結果 | 分類 |
|---|---|---|---|---|---|
| I-01 | Nest DI | TestingModule | increment port実行 | Service / Domain経由で +1 | 正常 |
| I-02 | GET health | Nest起動 | GET /api/health | 200 `{ status: "ok" }` | 正常 |
| I-03 | POST increment | Nest起動 | POST /api/foundation/probes/increment | 200とcount | 正常 |
| I-04 | GET probe | increment後 | GET /api/foundation/probes | 同じcount | 正常 |
| I-05 | 実PostgreSQL | Docker | 起動→SQL→increment→破棄 | 行が +1。コンテナ停止 | 正常 |
| I-06 | Docker不在 | daemon停止 | test:db | 失敗または未完了。PGliteに落ちない | 異常 |

## 特性観点

- 権限: 対象外（認証はM1。foundationは検証専用）
- データ整合性: UoW内の取得と保存が同じstore / 同じ接続であること（U-07, I-05）
- 冪等性: 対象外（検証incrementは冪等ではない。理由: 業務IdempotencyはM3）
- 障害系（外部I/Oがある場合）: 対象外（外部APIなし。Docker不在はI-06）
- フロントエンド（apps/webの場合）: ローディング / エラー表示（U-08, U-09）。楽観的更新はしない
- 防御性（Domain層Entity/VOの場合）:
  - 防御的コピー: 対象外（保持するのはnumberのみ）
  - 不変条件: 生成後に負数へ変えられない（U-02）
  - 副作用: 対象外（タイムスタンプなし）
  - 不正引数の伝搬: 負数・非整数・step=0・上限（U-02, U-03, U-05, U-06）

## メソッド網羅チェック表

| クラス | メソッド | 対応する試験観点No |
| ------ | -------- | ------------------- |
| ProbeCount | create | U-01, U-02, U-03 |
| ProbeCount | increment | U-04 |
| IncrementProbeService | increment | U-04, U-05, U-06 |
| IncrementProbeUseCase | execute | U-07, I-01, I-03 |
| GetProbeUseCase | execute | I-04 |
| ProbeController | get / increment | I-03, I-04 |
| HealthController | get | I-02 |
| PgProbeRepository | getCount / save | I-05 |
| PgFoundationUnitOfWork | run | I-05 |
| InMemory* | getCount / save / run | U-07, I-01 |
| http-client apiGet / apiPost | U-08, U-09 |
| useProbe / ProbePanel | U-08, U-09 |

## 回帰試験範囲

既存ハーネステスト（`node --test .claude/tests/*.test.mjs`）。アプリコードは新規のため業務回帰なし。

## 試験データ

- ProbeCount: -1, 0, 1, 1.5, 1000000
- HTTP: health / get / increment
- DB: `infra.m0_probes`のid=`default`

## 完了条件

- U-01〜U-10とI-01〜I-04がローカルで成功する。
- I-05はDockerがある環境（CI）で成功する。無い場合はI-06として未完了報告。
- Playwright / T-01〜18 / UI-01〜32を成功扱いにしない。
