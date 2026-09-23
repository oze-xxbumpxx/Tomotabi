# 実装計画: m0-validation-result-client

- 前提となる設計書: docs/designs/m0-validation-result-client.md（2026-09-23 ユーザー承認）
- レベル: L2
- 実装ルート: Claude Code が直接実装（サブエージェントなし）
- 採用バージョン（2026-09-23 確認・lockfile で固定）: orval 8.36.0（Node >=22.18.0）、zod 4.6.5、neverthrow 8.2.0

## スパイクで確定したこと

- Orval は 1 つの OpenAPI から 2 つの出力を作る。`client: "fetch"`（通信関数と型）と `client: "zod"`（応答スキーマ）で、どちらも `mode: "single"`。
- 生成関数は `httpClient<T>(url, options)` を呼び、`T = { data, status: 200, headers }` を受け取る。生成される型は 200 応答だけ。
- 生成 Zod の export 名は `GetHealthResponse`、`GetProbeResponse`、`IncrementProbeResponse`。count は `zod.int().min(0)`。
- 生成された POST は `content-type` を付けないため、mutator 側で付ける。

## 変更対象ファイル

| path | なぜ変えるか |
|---|---|
| `orval.config.ts`（新規） | foundation.json から fetch client と Zod を生成する |
| `package.json` | orval（devDependency）、`api:generate` と `api:check` スクリプト |
| `apps/web/package.json` | zod、neverthrow を dependencies に追加 |
| `apps/web/src/shared/api/generated/`（新規・生成物） | `foundation.ts`、`foundation.zod.ts`。手編集禁止 |
| `apps/web/src/shared/api/api-failure.ts`（新規） | `ApiFailure` 判別 union と `ApiRequestError` |
| `apps/web/src/shared/api/http-client.ts` | 既存 `apiGet` / `apiPost` を Orval mutator `httpClient` に置き換える |
| `apps/web/src/shared/api/api-result.ts`（新規） | 生成関数の Promise を `ResultAsync` にし、Zod で検証する共通関数 |
| `apps/web/src/features/foundation/api/probe-api.ts` | 生成関数 + 生成 Zod で `ResultAsync<ProbeView, ApiFailure>` を返す |
| `apps/web/src/features/foundation/model/use-probe.ts` | try/catch を `match` に置き換え、失敗を利用者向け文言へ変換 |
| `eslint.config.mjs` | 生成物（`**/shared/api/generated/**`）を lint 対象外にする |
| `.github/workflows/ci.yml` | quality ジョブに `npm run api:check`（再生成して差分が無いこと）を追加 |
| `apps/web/tests/*` | 下記の試験計画 |

## ファイルごとの変更内容

### `api-failure.ts`

- `ApiFailure = { kind: "network" } | { kind: "http"; status: number } | { kind: "invalid-json" } | { kind: "validation" }`。本文や例外メッセージは持たない（画面に出さないため）。
- `ApiRequestError`: mutator が投げる例外。`failure: ApiFailure` を持つ。
- 完了条件: UI 層が ZodError・fetch の例外型に依存しない。

### `http-client.ts`（mutator）

- `httpClient<T>(url, options)`: `credentials: "include"`、`cache: "no-store"`。GET 以外は `content-type: application/json` を付ける。
- fetch が reject → `network`。非 2xx → `http(status)`。本文が空、または JSON として読めない → `invalid-json`。成功時は `{ data, status, headers }` を返す（`data` は未検証）。
- 完了条件: 既存の経路・メソッド・Cookie・no-store の送り方が変わらない。

### `api-result.ts`

- `callApi(promise, schema)`: `ResultAsync.fromPromise` で取り込み、`ApiRequestError` 以外の例外は `network` に寄せる。`andThen` で `schema.safeParse(response.data)` を行い、失敗は `validation`。
- 完了条件: 未処理の Promise rejection が出ない。検証を通った値だけが Ok になる。

### `probe-api.ts` / `use-probe.ts`

- `getProbe()` / `incrementProbe()` は `ResultAsync<ProbeView, ApiFailure>` を返す。
- hook は `match` で成功時だけ count を更新する。失敗時は前回の count を保持して文言を出す。どちらの場合も pending を解除する。
- 文言: network「通信できませんでした」、http「サーバーでエラーが発生しました（HTTP {status}）」、invalid-json / validation「サーバーの応答を読み取れませんでした」。
- 完了条件: 画面の見た目と操作は M0 と同じ。

### 公開型の互換

- `packages/contracts` の `ProbeView` / `HealthView` は変更しない。生成型との双方向の型互換を、型テストで確認する。

## 実施順

1. 依存追加と `orval.config.ts`、生成（済み: スパイク）
2. `api-failure.ts` → `http-client.ts` → `api-result.ts`
3. `probe-api.ts` → `use-probe.ts`
4. テスト（試験計画 docs/tests/m0-validation-result-client.md）
5. ESLint の除外、CI の生成差分確認、README の追記
6. 品質ゲート（lint / type-check / test / build / api:check）

## リスクとロールバック

- 生成物の書式が Orval の版で変わる: 版を固定し、`api:check` で検出する。
- ロールバック: PR の revert で M0 の手書き fetch に戻る。DB・API は変更しない。
