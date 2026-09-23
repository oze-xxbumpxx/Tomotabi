# 設計書: m0-validation-result-client

- ステータス: confirmed（2026-09-23 ユーザー設計承認。実装は feat/m0-validation-result-client）
- レベル: L2 / ユーザー承認: 必要
- 関連: `docs/designs/m0-foundation.md` / `docs/decisions/ADR-0001-m0-workspace-and-stack.md`
- 調査対象: `feat/m0-foundation` の実装。現行 main にアプリソースは未統合のため、実装時に開始地点を再確認する。

## 背景

ユーザーは Zod をバリデーションに使い、neverthrow と Orval を実際に触れる目的で導入したい。M0 には Next.js / NestJS / Drizzle の検証機能があり、フロントは手書き fetch と型アサーションで JSON を受け取っている。

## 目的

既存の検証カウンタを通じて「API クライアント生成 → 実行時検証 → 型付きエラー処理」を確認できる最小構成を作る。Next.js / NestJS / Drizzle、API 契約、DB と業務設計を維持する。

## 要件

- Zod で受信 JSON を検証し、不正な値を画面状態へ入れない。
- Orval で既存 OpenAPI から通信関数を生成し、手書きの経路・HTTP メソッド定義を置き換える。
- neverthrow で通信・検証の失敗を区別し、呼び出し元が成功と失敗を明示的に処理する。
- 既存の取得・加算・Cookie 送信・Next rewrite が引き続き動作する。
- 不要な新 API、入力欄、業務機能を追加しない。AI 機能は対象外。

## 対象範囲

web の foundation API 境界、共有 HTTP 通信、useProbe、契約生成設定、依存定義、関連テストと CI の生成差分確認。

## 対象外

NestJS 全層の Result 化、DB スキーマ変更、認証、M1 入力フォーム、TanStack Query 導入、ルーター変更、インフラ構築、デプロイ。サーバーの request validation は入力を持つ機能の設計時に具体化する。

## 現状構成

- `packages/contracts/openapi/foundation.json`: OpenAPI 3.1。health、probe 取得、probe 加算の 3 操作。
- `packages/contracts/src/probe.ts` / `health.ts`: 公開 TypeScript 型。
- `apps/web/src/shared/api/http-client.ts`: Cookie 付き fetch。JSON を `as T` で扱い、失敗は throw。
- `apps/web/src/features/foundation/api/probe-api.ts`: 経路とメソッドを手書き。
- `apps/web/src/features/foundation/model/use-probe.ts`: try/catch で画面状態を更新。
- POST increment はリクエスト body を定義していない。検証対象となる既存ユーザー入力はない。
- API の UnitOfWork は例外時に ROLLBACK する。

## 変更後構成

提案: OpenAPI を契約の正典として維持し、Orval の fetch client と Zod スキーマを生成する。Zod と neverthrow の利用は web の API 境界から始める。

| 対象 | 変更案 |
| --- | --- |
| ルート `orval.config.ts`（新規） | ローカル OpenAPI を入力に、fetch client と Zod schema を生成する設定 |
| `apps/web/src/shared/api/generated/`（新規） | クライアント・型・検証スキーマの生成先。手編集禁止 |
| `apps/web/src/shared/api/http-client.ts` | Orval の custom mutator。Cookie、no-store、HTTP/JSON エラー分類を担当 |
| `apps/web/src/shared/api/api-result.ts`（新規） | 共有の判別可能なエラー型と Promise → ResultAsync 変換 |
| `apps/web/src/features/foundation/api/probe-api.ts` | 生成関数の呼び出し、生成 Zod schema の safeParse、ResultAsync 返却 |
| `apps/web/src/features/foundation/model/use-probe.ts` | 成功・失敗を match 等で処理し、pending を終了させる |
| ルート / web の package.json と lockfile | Orval は生成用 devDependency、Zod / neverthrow は web の依存。生成・生成差分確認コマンドを追加 |
| 関連 web テスト / CI quality | HTTP 境界、検証失敗、画面回帰、生成再現性を確認 |

contracts にクライアント実装やサーバー内部型を持ち込まない。既存の公開 TypeScript 型は互換性のため維持し、生成型との双方向の型互換チェックを追加する。OpenAPI と異なる制約を手書き型や Zod 側で独自に追加しない。生成型は生成物であり、別の手編集正典にしない。

別解との比較:

- 手書き fetch + Zod: 工程は少ないが、今回の Orval を使う目的を満たさず経路の重複が残る。
- Zod を正典にして OpenAPI を生成: 入力検証を中心に据えやすいが、現 M0 の契約管理と contracts の責務変更が広がるため今回は採らない。
- Orval + TanStack Query: キャッシュ管理も導入できるが、今回の 3 技術の検証には不要。既存 hook を維持する案を推奨する。
- API 全層で neverthrow: 業務エラーを表現できるが、現在の UnitOfWork は返値の Err で rollback しない。現段階ではサーバーを変更しない案を推奨する。

## データフロー

1. useProbe → feature API wrapper → Orval 生成関数 → 共通 mutator → 同一 origin `/api/*`。
2. Next rewrite → 既存 Nest Controller / UseCase / UnitOfWork → 既存 DB または in-memory。
3. HTTP 成功応答を JSON 化し、feature 境界で生成 Zod schema による safeParse を実行する。
4. 検証済み値は Ok、通信・HTTP・不正 JSON・契約不一致は Err として返す。
5. hook が成功値だけを count に反映し、失敗は利用者向けメッセージへ変換する。

## API 設計

経路、メソッド、200 応答、body なしの increment を維持する。count は既存 OpenAPI と同じ非負整数、health status は `ok`。追加プロパティを理由に拒否する厳格化や文字列から数値への coercion は導入しない。

Orval の fetch 出力と custom mutator の呼び出し規約は採用バージョンで確認する。生成クライアントの型付けだけでは実行時検証が済んだと扱わず、safeParse を通った値だけを feature API から公開する。Zod schema を別出力にする設定を優先し、生成 client と組み合わせて検証する。正確な export 名は生成結果に合わせる。

## DB 設計

変更なし。Drizzle、pg、`infra.m0_probes`、COMMIT / ROLLBACK の規約を維持する。

## フロントエンド設計

app → screens → features → shared の依存方向を維持する。生成物は shared 配下で feature を参照しない。API wrapper の返値は `ResultAsync<ProbeView, ApiFailure>` 相当とし、UI は ZodError や fetch の例外に直接依存しない。取得成功・加算成功の表示、pending 中の操作制御は維持する。

## バックエンド設計

変更なし。M0 では検証すべき request body / params がなく、Zod 導入のためだけの新 API は作らない。M1 以降に入力が生じた際は Controller 境界で Zod を利用する方針を検討する。クライアント側の検証はサーバー入力検証の代わりにならない。

## エラー処理

`ApiFailure` は network、http（status）、invalid-json、validation の判別可能な union とする。受信 body や内部のエラー文をそのまま画面へ表示しない。catch 対象の Promise を `ResultAsync.fromPromise` で取り込み、Zod の safeParse 失敗を validation に変換する。Orval 内部の Promise 境界は残し、公開 feature API で Result に統一する。

- リトライ: GET / POST とも自動リトライ 0 回。非冪等な increment を自動再送しない。
- タイムアウト: 本変更では新設しない。現状は HTTP アプリタイムアウト未設定のため、応答が終わらない間 pending が続き得る。M1 の通信方針で別途扱う。
- 冪等性: increment は既存どおり冪等性キーなし。失敗後の加算成功有無は保証せず、必要なら再取得して確認する。
- 部分失敗: サーバーの UnitOfWork を変更しない。応答の検証失敗はサーバーの commit を取り消さない。
- フォールバック: 不正な応答では前回の正常な値を保持し、エラーを表示する。失敗を count 0 の成功値に置き換えない。

## ログと監視

新規基盤は対象外。画面で分類したエラーを扱うため、レスポンス本文や認証情報をログへ追加しない。

## セキュリティ

Cookie の `credentials: include` を維持する。生成入力はリポジトリ内の OpenAPI に固定し、秘密情報を埋め込まない。生成コードによる base URL の置き換えで既存同一 origin 通信を壊さない。foundation を本番公開しない既存方針を維持する。

## 性能

検証カウンタの小さな JSON に対して受信ごとに 1 回検証する。Zod の重複検証や Query キャッシュは追加しない。ビルドで client bundle の互換性を確認する。

## テスト方針

- 既存 GET / POST の経路、HTTP メソッド、Cookie、no-store、加算表示を確認。
- 0 と正整数は受理し、負数・小数・文字列・欠損・null は validation Err。不正 JSON / 空の成功応答は invalid-json Err。
- HTTP 非 2xx、ネットワーク失敗を区別し、未処理の Promise rejection を発生させない。
- 失敗時に count を更新せず、エラー表示と pending の解除を確認。
- OpenAPI → Orval の再生成に差分がなく、生成型と既存公開型が双方向で互換であることを確認。
- 既存 API HTTP テストと web / API の lint・型検査・テスト・build を実行する。DB実装は変更しない。DBゲートの要否は実装差分と既存CIに従う。

詳細な試験計画・実装計画は本設計承認後に作成する。現時点では実装・テスト実行済みとは扱わない。

## 移行とリリース

M0 実装が利用できる作業ブランチで、ユーザーの設計承認後に実装する。main の状態と M0 PR の統合状況を再確認する。依存バージョンは Node 22 / 既存 TypeScript と互換性を確認して lockfile に固定する。生成物はコミット対象とし、CI の生成差分確認で更新忘れを検知する。PR マージはユーザーが行う。本番公開は対象外。

## リスク

- Orval / Zod のバージョンによって生成設定・出力が異なる。採用バージョンで schema と mutator の型を検証する。
- OpenAPI と既存手書き公開型は二重管理箇所が残る。生成型との互換チェックで検知し、今後の公開型生成への一本化は別途判断する。
- neverthrow は例外を自動的に全廃するものではない。HTTP 境界の既知失敗を扱う範囲を明示する。
- 現在の M0 は入力フォームを持たないため、今回は Zod のレスポンス検証を体験する段階となる。

## 未決事項

- ユーザー確認: 「既存基盤を維持し、web の API 境界で 3 技術を導入する」本提案の承認。
- 実装時確認: Node 22 と互換性のある具体的な依存バージョン、Orval の生成設定と export 名。承認済み範囲内の調整として記録する。

公式参照（2026-09-22 確認）:

- [Orval output 設定](https://orval.dev/docs/reference/configuration/output/)
- [Orval と Zod の連携](https://orval.dev/docs/guides/client-with-zod/)
- [Zod safeParse](https://zod.dev/basics)
- [neverthrow ResultAsync](https://github.com/supermacro/neverthrow)
