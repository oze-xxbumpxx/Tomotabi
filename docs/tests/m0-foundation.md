# 試験計画: m0-foundation

- 前提となる設計書: docs/designs/m0-foundation.md
- レベル: L3

## 試験種別

- 単体: Domain / Service / UseCase（in-memory） / web component / 境界 lint
- 結合: @nestjs/testing + Supertest（HTTP）
- 実 DB: Testcontainers PostgreSQL（Docker 必須。無ければ未完了）
- E2E: 対象外（Playwright は未導入。成功扱いにしない）

## 単体試験観点

| # | 観点 | 前提 | 操作 | 期待結果 | 分類(正常/異常/境界) |
|---|---|---|---|---|---|
| U-01 | ProbeCount 0 | なし | `create(0)` | 値 0 | 境界 |
| U-02 | ProbeCount 負数 | なし | `create(-1)` | 例外 | 異常 |
| U-03 | ProbeCount 非整数 | なし | `create(1.5)` | 例外 | 異常 |
| U-04 | increment +1 | count=0 | Service.increment | 1 | 正常 |
| U-05 | step 不正 | count=0 | step=0 | 例外 | 異常 |
| U-06 | 上限超過 | count=1000000 | increment | 例外 | 境界 |
| U-07 | UseCase が IF だけを使う | fake UoW / Service | execute | 保存値が +1 | 正常 |
| U-08 | web が API 失敗を表示 | fetch 拒否 | 描画 | エラー文言 | 異常 |
| U-09 | web が件数を表示 | fetch 成功 | 描画 | 件数 | 正常 |
| U-10 | 禁止 import | fixture | eslint | エラー | 正常（検知） |

## 結合試験観点

| # | 観点 | 前提 | 操作 | 期待結果 | 分類 |
|---|---|---|---|---|---|
| I-01 | Nest DI | TestingModule | increment port 実行 | Service / Domain 経由で +1 | 正常 |
| I-02 | GET health | Nest 起動 | GET /api/health | 200 `{ status: "ok" }` | 正常 |
| I-03 | POST increment | Nest 起動 | POST /api/foundation/probes/increment | 200 と count | 正常 |
| I-04 | GET probe | increment 後 | GET /api/foundation/probes | 同じ count | 正常 |
| I-05 | 実 PostgreSQL | Docker | 起動→SQL→increment→破棄 | 行が +1。コンテナ停止 | 正常 |
| I-06 | Docker 不在 | daemon 停止 | test:db | 失敗または未完了。PGlite に落ちない | 異常 |

## 特性観点

- 権限: 対象外（認証は M1。foundation は検証専用）
- データ整合性: UoW 内の取得と保存が同じ store / 同じ接続であること（U-07, I-05）
- 冪等性: 対象外（検証 increment は冪等ではない。理由: 業務 Idempotency は M3）
- 障害系（外部 I/O がある場合）: 対象外（外部 API なし。Docker 不在は I-06）
- フロントエンド（apps/web の場合）: ローディング / エラー表示（U-08, U-09）。楽観的更新はしない
- 防御性（Domain 層 Entity/VO の場合）:
  - 防御的コピー: 対象外（保持するのは number のみ）
  - 不変条件: 生成後に負数へ変えられない（U-02）
  - 副作用: 対象外（タイムスタンプなし）
  - 不正引数の伝搬: 負数・非整数・step=0・上限（U-02, U-03, U-05, U-06）

## メソッド網羅チェック表

| クラス | メソッド | 対応する試験観点 No |
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
- DB: `infra.m0_probes` の id=`default`

## 完了条件

- U-01〜U-10 と I-01〜I-04 がローカルで成功する。
- I-05 は Docker がある環境（CI）で成功する。無い場合は I-06 として未完了報告。
- Playwright / T-01〜18 / UI-01〜32 を成功扱いにしない。
