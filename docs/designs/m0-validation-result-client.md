# 設計書: m0-validation-result-client

- ステータス: confirmed（2026-09-23ユーザー設計承認。実装はfeat/m0-validation-result-client）
- レベル: L2 / ユーザー承認: 必要
- 関連: `docs/designs/m0-foundation.md` / `docs/decisions/ADR-0001-m0-workspace-and-stack.md`
- 調査対象: `feat/m0-foundation`の実装。現行mainにアプリソースは未統合のため、実装時に開始地点を再確認する。

## 背景

ユーザーはZodをバリデーションに使い、neverthrowとOrvalを実際に触れる目的で導入したい。M0にはNext.js / NestJS / Drizzleの検証機能があり、フロントは手書きfetchと型アサーションでJSONを受け取っている。

## 目的

既存の検証カウンタを通じて「APIクライアント生成 → 実行時検証 → 型付きエラー処理」を確認できる最小構成を作る。Next.js / NestJS / Drizzle、API契約、DBと業務設計を維持する。

## 要件

- Zodで受信JSONを検証し、不正な値を画面状態へ入れない。
- Orvalで既存OpenAPIから通信関数を生成し、手書きの経路・HTTPメソッド定義を置き換える。
- neverthrowで通信・検証の失敗を区別し、呼び出し元が成功と失敗を明示的に処理する。
- 既存の取得・加算・Cookie送信・Next rewriteが引き続き動作する。
- 不要な新API、入力欄、業務機能を追加しない。AI機能は対象外。

## 対象範囲

webのfoundation API境界、共有HTTP通信、useProbe、契約生成設定、依存定義、関連テストとCIの生成差分確認。

## 対象外

NestJS全層のResult化、DBスキーマ変更、認証、M1入力フォーム、TanStack Query導入、ルーター変更、インフラ構築、デプロイ。サーバーのrequest validationは入力を持つ機能の設計時に具体化する。

## 現状構成

- `packages/contracts/openapi/foundation.json`: OpenAPI 3.1。health、probe取得、probe加算の3操作。
- `packages/contracts/src/probe.ts` / `health.ts`: 公開TypeScript型。
- `apps/web/src/shared/api/http-client.ts`: Cookie付きfetch。JSONを`as T`で扱い、失敗はthrow。
- `apps/web/src/features/foundation/api/probe-api.ts`: 経路とメソッドを手書き。
- `apps/web/src/features/foundation/model/use-probe.ts`: try/catchで画面状態を更新。
- POST incrementはリクエストbodyを定義していない。検証対象となる既存ユーザー入力はない。
- APIのUnitOfWorkは例外時にROLLBACKする。

## 変更後構成

提案: OpenAPIを契約の正典として維持し、Orvalのfetch clientとZodスキーマを生成する。Zodとneverthrowの利用はwebのAPI境界から始める。

| 対象 | 変更案 |
| --- | --- |
| ルート`orval.config.ts`（新規） | ローカルOpenAPIを入力に、fetch clientとZod schemaを生成する設定 |
| `apps/web/src/shared/api/generated/`（新規） | クライアント・型・検証スキーマの生成先。手編集禁止 |
| `apps/web/src/shared/api/http-client.ts` | Orvalのcustom mutator。Cookie、no-store、HTTP/JSONエラー分類を担当 |
| `apps/web/src/shared/api/api-result.ts`（新規） | 共有の判別可能なエラー型とPromise → ResultAsync変換 |
| `apps/web/src/features/foundation/api/probe-api.ts` | 生成関数の呼び出し、生成Zod schemaのsafeParse、ResultAsync返却 |
| `apps/web/src/features/foundation/model/use-probe.ts` | 成功・失敗をmatch等で処理し、pendingを終了させる |
| ルート / webのpackage.jsonとlockfile | Orvalは生成用devDependency、Zod / neverthrowはwebの依存。生成・生成差分確認コマンドを追加 |
| 関連webテスト / CI quality | HTTP境界、検証失敗、画面回帰、生成再現性を確認 |

contractsにクライアント実装やサーバー内部型を持ち込まない。既存の公開TypeScript型は互換性のため維持し、生成型との双方向の型互換チェックを追加する。OpenAPIと異なる制約を手書き型やZod側で独自に追加しない。生成型は生成物であり、別の手編集正典にしない。

別解との比較:

- 手書きfetch + Zod: 工程は少ないが、今回のOrvalを使う目的を満たさず経路の重複が残る。
- Zodを正典にしてOpenAPIを生成: 入力検証を中心に据えやすいが、現M0の契約管理とcontractsの責務変更が広がるため今回は採らない。
- Orval + TanStack Query: キャッシュ管理も導入できるが、今回の3技術の検証には不要。既存hookを維持する案を推奨する。
- API全層でneverthrow: 業務エラーを表現できるが、現在のUnitOfWorkは返値のErrでrollbackしない。現段階ではサーバーを変更しない案を推奨する。

## データフロー

1. useProbe → feature API wrapper → Orval生成関数 → 共通mutator → 同一origin `/api/*`。
2. Next rewrite → 既存Nest Controller / UseCase / UnitOfWork → 既存DBまたはin-memory。
3. HTTP成功応答をJSON化し、feature境界で生成Zod schemaによるsafeParseを実行する。
4. 検証済み値はOk、通信・HTTP・不正JSON・契約不一致はErrとして返す。
5. hookが成功値だけをcountに反映し、失敗は利用者向けメッセージへ変換する。

## API設計

経路、メソッド、200応答、bodyなしのincrementを維持する。countは既存OpenAPIと同じ非負整数、health statusは`ok`。追加プロパティを理由に拒否する厳格化や文字列から数値へのcoercionは導入しない。

Orvalのfetch出力とcustom mutatorの呼び出し規約は採用バージョンで確認する。生成クライアントの型付けだけでは実行時検証が済んだと扱わず、safeParseを通った値だけをfeature APIから公開する。Zod schemaを別出力にする設定を優先し、生成clientと組み合わせて検証する。正確なexport名は生成結果に合わせる。

## DB設計

変更なし。Drizzle、pg、`infra.m0_probes`、COMMIT / ROLLBACKの規約を維持する。

## フロントエンド設計

app → screens → features → sharedの依存方向を維持する。生成物はshared配下でfeatureを参照しない。API wrapperの返値は`ResultAsync<ProbeView, ApiFailure>`相当とし、UIはZodErrorやfetchの例外に直接依存しない。取得成功・加算成功の表示、pending中の操作制御は維持する。

## バックエンド設計

変更なし。M0では検証すべきrequest body / paramsがなく、Zod導入のためだけの新APIは作らない。M1以降に入力が生じた際はController境界でZodを利用する方針を検討する。クライアント側の検証はサーバー入力検証の代わりにならない。

## エラー処理

`ApiFailure`はnetwork、http（status）、invalid-json、validationの判別可能なunionとする。受信bodyや内部のエラー文をそのまま画面へ表示しない。catch対象のPromiseを`ResultAsync.fromPromise`で取り込み、ZodのsafeParse失敗をvalidationに変換する。Orval内部のPromise境界は残し、公開feature APIでResultに統一する。

- リトライ: GET / POSTとも自動リトライ0回。非冪等なincrementを自動再送しない。
- タイムアウト: 本変更では新設しない。現状はHTTPアプリタイムアウト未設定のため、応答が終わらない間pendingが続き得る。M1の通信方針で別途扱う。
- 冪等性: incrementは既存どおり冪等性キーなし。失敗後の加算成功有無は保証せず、必要なら再取得して確認する。
- 部分失敗: サーバーのUnitOfWorkを変更しない。応答の検証失敗はサーバーのcommitを取り消さない。
- フォールバック: 不正な応答では前回の正常な値を保持し、エラーを表示する。失敗をcount 0の成功値に置き換えない。

## ログと監視

新規基盤は対象外。画面で分類したエラーを扱うため、レスポンス本文や認証情報をログへ追加しない。

## セキュリティ

Cookieの`credentials: include`を維持する。生成入力はリポジトリ内のOpenAPIに固定し、秘密情報を埋め込まない。生成コードによるbase URLの置き換えで既存同一origin通信を壊さない。foundationを本番公開しない既存方針を維持する。

## 性能

検証カウンタの小さなJSONに対して受信ごとに1回検証する。Zodの重複検証やQueryキャッシュは追加しない。ビルドでclient bundleの互換性を確認する。

## テスト方針

- 既存GET / POSTの経路、HTTPメソッド、Cookie、no-store、加算表示を確認。
- 0と正整数は受理し、負数・小数・文字列・欠損・nullはvalidation Err。不正JSON / 空の成功応答はinvalid-json Err。
- HTTP非2xx、ネットワーク失敗を区別し、未処理のPromise rejectionを発生させない。
- 失敗時にcountを更新せず、エラー表示とpendingの解除を確認。
- OpenAPI → Orvalの再生成に差分がなく、生成型と既存公開型が双方向で互換であることを確認。
- 既存API HTTPテストとweb / APIのlint・型検査・テスト・buildを実行する。DB実装は変更しない。DBゲートの要否は実装差分と既存CIに従う。

詳細な試験計画・実装計画は本設計承認後に作成する。現時点では実装・テスト実行済みとは扱わない。

## 移行とリリース

M0実装が利用できる作業ブランチで、ユーザーの設計承認後に実装する。mainの状態とM0 PRの統合状況を再確認する。依存バージョンはNode 22 / 既存TypeScriptと互換性を確認してlockfileに固定する。生成物はコミット対象とし、CIの生成差分確認で更新忘れを検知する。PRマージはユーザーが行う。本番公開は対象外。

## リスク

- Orval / Zodのバージョンによって生成設定・出力が異なる。採用バージョンでschemaとmutatorの型を検証する。
- OpenAPIと既存手書き公開型は二重管理箇所が残る。生成型との互換チェックで検知し、今後の公開型生成への一本化は別途判断する。
- neverthrowは例外を自動的に全廃するものではない。HTTP境界の既知失敗を扱う範囲を明示する。
- 現在のM0は入力フォームを持たないため、今回はZodのレスポンス検証を体験する段階となる。

## 未決事項

- ユーザー確認: 「既存基盤を維持し、webのAPI境界で3技術を導入する」本提案の承認。
- 実装時確認: Node 22と互換性のある具体的な依存バージョン、Orvalの生成設定とexport名。承認済み範囲内の調整として記録する。

公式参照（2026-09-22確認）:

- [Orval output 設定](https://orval.dev/docs/reference/configuration/output/)
- [Orval と Zod の連携](https://orval.dev/docs/guides/client-with-zod/)
- [Zod safeParse](https://zod.dev/basics)
- [neverthrow ResultAsync](https://github.com/supermacro/neverthrow)
