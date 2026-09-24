# 実装計画: m1-auth-onboarding

- 前提となる設計書: docs/designs/m1-auth-onboarding.md（2026-09-23 承認）、docs/requirements/m1-auth-onboarding.md、ADR-0002、ADR-0003
- レベル: L3
- 実装ルート: Claude Code が直接実装（サブエージェントなし）。実装後に security-reviewer 観点のレビューを必ず行う
- 判断理由: 既定。ただし変更量が大きいため、4 つの PR に分けて出す（下記「PR の分け方」）

## PR の分け方

| PR | 範囲 | 手順 | マージ後にできること |
|---|---|---|---|
| M1-a | DB の土台 | 0〜3 | identity スキーマ・migration・ロール・GRANT がそろい、権限テストが CI で回る |
| M1-b | API の認証 | 4〜9 | Better Auth・Guard・`/api/me`・ログがそろい、fixture で二人・第三者・失効・Origin を検証できる |
| M1-c | 管理 CLI | 10〜11 | 初期登録と利用停止ができる |
| M1-d | web と実 Google 確認 | 12〜15 | サインインからログアウトまでを、ローカルの実 Google で確認できる |

各 PR は単独で品質ゲートを通す。M1-a が後続すべての前提になる。

## 変更対象ファイル

| path | なぜ変えるか |
|---|---|
| `apps/api/src/main.ts` | `bodyParser: false` で起動し、`configure-app` を呼ぶ |
| `apps/api/src/app.module.ts` | IdentityModule、APP_GUARD（OriginGuard → SessionGuard）、LoggerModule を登録 |
| `apps/api/src/modules/foundation/controller/health.controller.ts` | `@PublicRoute()` を付ける（B-04） |
| `apps/api/package.json` | better-auth、nestjs-pino、pino-http、google-auth-library、drizzle-kit、`db:*` と `cli:*` スクリプト |
| `apps/web/src/app/page.tsx`、`screens/home/*` | ログイン後の最小ホーム（表示名・ログアウト・既存の検証パネル） |
| `apps/web/package.json` | `better-auth`（React クライアントのみ使用）、`@phosphor-icons/react` |
| `apps/web/src/app/globals.css` | デザイン v3 のトークンを CSS カスタムプロパティで定義 |
| `packages/contracts/src/index.ts` | `Me` 型を公開 |
| `orval.config.ts` | auth.json から `/me` を生成する出力を追加 |
| `eslint.config.mjs` | `apps/api/src/cli/**` から Nest の AppModule を import しない制約 |
| `.github/workflows/ci.yml` | 変更なしの見込み（`test:api-db` に DB テストが増えるだけ）。必要なら timeout を延ばす |
| `README.md` | ローカル DB・ロール・migration・初期登録・OAuth クライアントの手順 |

## 新規作成ファイル

| path | 役割 |
|---|---|
| `compose.yaml` | ローカル用 `postgres:16-alpine`。初期化で `create-roles.sql` を流す |
| `.env.example` | 環境変数の名前だけ（値なし） |
| `apps/api/drizzle.config.ts` | `MIGRATION_DATABASE_URL`、schema、out=`drizzle/` |
| `apps/api/drizzle/*.sql`、`drizzle/meta/*` | migration 履歴（生成物＋カスタム SQL。コミット対象） |
| `apps/api/db/admin/create-roles.sql` | `migrator` / `app_runtime` の作成（クラスタごとに 1 回）。パスワードは psql 変数で渡す |
| `apps/api/db/admin/grant-database.sql` | DB ごとの接続・作成権限（再実行可） |
| `apps/api/src/infrastructure/database/schema/identity.ts` | Better Auth 標準 4 表＋ `allowed_google_accounts` |
| `apps/api/src/infrastructure/logging/logger.ts` | Pino 設定（許可項目の serializer と redact） |
| `apps/api/src/bootstrap/configure-app.ts` | 認証経路の許可リスト → Better Auth → JSON パーサー → prefix |
| `apps/api/src/bootstrap/auth-route-allowlist.ts` | 公開 4 経路以外を 404、POST の Origin 必須 |
| `apps/api/src/common/domain/user-id.ts` | `UserId` ブランド型と `parse` |
| `apps/api/src/common/guard/{session,origin}.guard.ts`、`public-route.decorator.ts`、`current-user.decorator.ts` | 共通 Guard とデコレーター |
| `apps/api/src/modules/identity/**` | 設計書「変更後構成」のとおり（Controller / UseCase / Adapter / Infrastructure） |
| `apps/api/src/cli/{enroll,disable}-google-account.ts` | 管理 CLI |
| `packages/contracts/openapi/auth.json`、`src/me.ts` | 認証 API の契約と wire 型 |
| `apps/web/src/features/auth/{ui,model,api}/*`、`index.ts` | ログインボタン・me 取得・ログアウト |
| `apps/web/src/screens/sign-in/*`、`apps/web/src/app/sign-in/page.tsx` | サインイン画面（デザイン v3 の 01・02） |
| `apps/web/src/shared/auth/auth-client.ts` | `createAuthClient`（baseURL は相対） |
| テスト一式 | docs/tests/m1-auth-onboarding.md の配置どおり |

## 実装手順

### M1-a: DB の土台

0. **スパイク（R-2・R-4）** … 使い捨てのテストで次を確かめる。結果を設計書の「実装時確認」に書き戻し、想定と違えば先に設計を直す。
   - `npx auth@latest generate`（better-auth 1.7.x を lockfile で固定）の出力と、`pgSchema("identity")` + `modelName` 複数形 + `generateId: "uuid"` の組み合わせ
   - `databaseHooks.session.create.before` が `false` を返したとき、セッション行が作られずにエラーになるか
   - `databaseHooks.account.update.before`（と create）で token 列を null にできるか
   - `accountLinking.disableImplicitLinking` 相当のキーが 1.7.x にあるか
   - セッショントークンの DB 保存形式（ハッシュか平文か）
   - `better-auth/test` で、テストプロセス内から署名済み Cookie と DB セッションを作れるか
   - 完了条件: 6 項目の結果を記録し、設計の変更が要るかを判断した
1. **スキーマ定義** … `schema/identity.ts`。Better Auth の生成結果を正とし、allowlist は `sql/02_auth_allowlist.sql` を移す（CHECK・UNIQUE・FK）。完了条件: `drizzle-kit generate` が差分なしで再現する
2. **migration とロール** … `drizzle-kit generate` → レビュー。`generate --custom` で GRANT（設計書の表）と `app_runtime` の `statement_timeout = '5s'` を書く。`create-roles.sql` と `compose.yaml`。`db:generate` / `db:migrate` / `db:check` スクリプト。完了条件: 空の DB へ `db:migrate` が通り、2 回目は何もしない
3. **DB テスト** … Testcontainers にロールを作って migrate し、スキーマ・制約・権限を検証（試験計画 D-01〜D-12）。完了条件: `test:api-db` が成功

### M1-b: API の認証

4. **UserId と Guard の骨組み** … `user-id.ts`、`@PublicRoute`、`@CurrentUser`、`SessionVerifier` IF と結果の 4 値。完了条件: 単体テスト（U-01〜U-10）が成功
5. **Better Auth の設定** … `better-auth.ts`（設計書の設定値。`disabledPaths`、before フック、DB フック）と `allowlist-query.ts`。`DATABASE_URL` が無いときは生成せず、Verifier が `unavailable` を返す。完了条件: スパイクで確かめた挙動がテストで再現する
6. **組み込み** … `auth-route-allowlist.ts`、`configure-app.ts`、`main.ts`。完了条件: 実 HTTP で sign-in POST の body・callback のクエリ・複数 Set-Cookie が欠けない（H-01〜H-03）
7. **Guard の実装と適用** … OriginGuard（状態変更要求の Origin 完全一致 → Content-Type）、SessionGuard（Verifier → 403/401/503）。health に `@PublicRoute`。完了条件: foundation の既存 HTTP テストが「ログイン済み」前提で通り、未ログインでは 401
8. **`/api/me`** … contracts の auth.json・`Me` 型、Controller → GetMeUseCase → IdentityReader。完了条件: sub・メール・トークンが応答に含まれない
9. **ログ** … `nestjs-pino` と serializer・redact。例外は既知の code に変換。完了条件: L-01〜L-04（ログに秘密が出ない）が成功

### M1-c: 管理 CLI

10. **初期登録 CLI** … ループバックの一時サーバー、state / PKCE / nonce、`google-auth-library` の `verifyIdToken`、確認プロンプト、1 トランザクションでの INSERT。Google との通信部分は IF にして、テストでは fake に差し替える。完了条件: C-01〜C-07
11. **利用停止 CLI** … enabled=false と sessions の DELETE を 1 トランザクションで。完了条件: C-08〜C-09

### M1-d: web と実 Google 確認

12. **トークンと共通スタイル** … デザイン v3 の色・書体・余白・角丸を `globals.css` に定義。ダークの値も定義だけする（画面の見た目は第 4 弾）
13. **features/auth** … `/me` を Orval で生成し、`callApi` で呼ぶ。`useMe`、`useSignOut`、`SignInButton`（`signIn.social`、callbackURL は `/`）。完了条件: W-01〜W-08
14. **画面** … サインイン（01・02。エラー文はデザインと違う一般的な文にする。設計書「画面デザイン」参照）、ログイン後の最小ホーム（表示名・ログアウト・検証パネル）、401 → `/sign-in`、503 の表示
15. **実 Google の手動確認** … ユーザーが開発用 OAuth クライアントを作った後に行う。M-01〜M-07 を実施し、結果をログに記録する

## 依存関係

- 0 → 1 → 2 → 3（M1-a）→ 4〜9（M1-b）→ 10〜11（M1-c）→ 12〜15（M1-d）
- 5 は 0 のスパイク結果に依存する。0 で設計と違う挙動が見つかったら、設計書を直してユーザーに報告してから 1 へ進む
- 10 は 2（ロール）と 5（スキーマ）に依存する
- 15 はユーザーの OAuth クライアント作成に依存する。12〜14 は作成前に進められる
- 生成クライアント（Orval）の import 制約は、メインの作業ツリーにある未コミットの ESLint 変更と関係する。その変更が main に入ってから 13 に着手する

## テスト計画

docs/tests/m1-auth-onboarding.md のとおり。配置は次のとおり。

- `apps/api/tests/{domain,guard,bootstrap,identity,logging,cli}/*.test.ts`（単体・HTTP。DB なし）
- `apps/api/tests/db/{migration,roles,auth-http,cli}.db.test.ts`（Testcontainers）
- `apps/api/tests/support/`（ロール作成・migrate・fixture のセッション発行。本番コードから import しない）
- `apps/web/tests/{auth-api,use-me,sign-in-screen,home-screen}.test.tsx`

## リスク

| ID | リスク | 対策 |
|---|---|---|
| R-1 | body parser と Better Auth の衝突 | 手順 6 で実 HTTP の H-01〜H-03 を先に通す |
| R-2 | DB フックやキー名が 1.7.x で想定と違う | 手順 0 のスパイクで先に確かめ、違えば設計を直す |
| R-3 | Next の rewrite が Set-Cookie やリダイレクトを変える | 手順 15 の手動確認。問題があれば認証経路だけ API へ直接リダイレクトする案をユーザーに提示 |
| R-4 | 生成スキーマと `pgSchema` の組み合わせ | 手順 0 で生成物を確認してから GRANT を書く |
| R-5 | CI の api-db ジョブが長くなる | コンテナを 1 ファイル 1 回にまとめる。15 分を超えたら timeout を見直す |
| R-6 | テスト用のセッション発行が本番に混ざる | fixture は `tests/support` だけに置き、ESLint とレビューで本番コードからの import を禁止する |

## ロールバック方法

- 本番環境・本番データが無いため、各 PR の revert で戻せる。
- M1-a の migration は、本番へ適用する前ならフォルダごと作り直してよい（ADR-0003）。

## ドキュメント更新対象

- 設計書: 手順 0 の結果（「実装時確認」の項目）と、users の UPDATE 権限の要否
- README: ローカル DB・ロール・migration・初期登録・OAuth クライアントの手順、登録するリダイレクト URI
- AGENTS.md / ADR: 変更なしの見込み（スパイクで方式が変われば ADR-0002 を更新）
- ドメインモデル文書: このリポジトリには存在しないため対象外
