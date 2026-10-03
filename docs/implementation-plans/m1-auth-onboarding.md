# 実装計画: m1-auth-onboarding

- 前提となる設計書: docs/designs/m1-auth-onboarding.md（2026-09-23承認）、docs/requirements/m1-auth-onboarding.md、ADR-0002、ADR-0003
- レベル: L3
- 実装ルート: Claude Codeが直接実装（サブエージェントなし）。実装後にsecurity-reviewer観点のレビューを必ず行う
- 判断理由: 既定。ただし変更量が大きいため、4つのPRに分けて出す（下記「PRの分け方」）

## PRの分け方

| PR | 範囲 | 手順 | マージ後にできること |
|---|---|---|---|
| M1-a | DBの土台 | 0〜3 | identityスキーマ・migration・ロール・GRANTがそろい、権限テストがCIで回る |
| M1-b1 | Guardの土台 | 4、7のロジック | `UserId`・デコレーター・`SessionVerifier` IF・両Guardの判定が単体テスト（U-01〜U-10）で固まる。全体適用はしない |
| M1-b2 | ログ | 9 | Pinoのログが許可項目だけを出し、秘密を伏せる（U-17・U-18） |
| M1-b3 | 契約と`/me`の中身 | 8の契約・UseCase | `auth.json`・`Me`型・`IdentityReader` IF・`GetMeUseCase`（U-16）がそろう。ControllerはM1-b4 |
| M1-b4 | 認証の組み込み | 5、6、7の適用、8のController | Better Auth・経路制限・Guardの全体適用・`/api/me`がつながり、fixtureで二人・第三者・失効・Originを検証できる（U-11〜U-15、H、A） |
| M1-c | 管理CLI | 10〜11 | 初期登録と利用停止ができる |
| M1-d | webと実Google確認 | 12〜15 | サインインからログアウトまでを、ローカルの実Googleで確認できる |

各PRは単独で品質ゲートを通す。M1-aが後続すべての前提になる。
M1-b1〜b3は互いに依存しないため並行で進める（2026-09-25ユーザー判断）。M1-b4はb1〜b3のマージ後に着手する。

## 変更対象ファイル

| path | なぜ変えるか |
|---|---|
| `apps/api/src/main.ts` | `bodyParser: false`で起動し、`configure-app`を呼ぶ |
| `apps/api/src/app.module.ts` | IdentityModule、APP_GUARD（OriginGuard → SessionGuard）、LoggerModuleを登録 |
| `apps/api/src/modules/foundation/controller/health.controller.ts` | `@PublicRoute()`を付ける（B-04） |
| `apps/api/package.json` | better-auth、nestjs-pino、pino-http、google-auth-library、drizzle-kit、`db:*`と`cli:*`スクリプト |
| `apps/web/src/app/page.tsx`、`screens/home/*` | ログイン後の最小ホーム（表示名・ログアウト・既存の検証パネル） |
| `apps/web/package.json` | `better-auth`（Reactクライアントのみ使用）、`@phosphor-icons/react` |
| `apps/web/src/app/globals.css` | デザインv3のトークンをCSSカスタムプロパティで定義 |
| `packages/contracts/src/index.ts` | `Me`型を公開 |
| `orval.config.ts` | auth.jsonから`/me`を生成する出力を追加 |
| `eslint.config.mjs` | `apps/api/src/cli/**`からNestのAppModuleをimportしない制約 |
| `.github/workflows/ci.yml` | 変更なしの見込み（`test:api-db`にDBテストが増えるだけ）。必要ならtimeoutを延ばす |
| `README.md` | ローカルDB・ロール・migration・初期登録・OAuthクライアントの手順 |

## 新規作成ファイル

| path | 役割 |
|---|---|
| `compose.yaml` | ローカル用`postgres:16-alpine`。初期化で`create-roles.sql`を流す |
| `.env.example` | 環境変数の名前だけ（値なし） |
| `apps/api/drizzle.config.ts` | `MIGRATION_DATABASE_URL`、schema、out=`drizzle/` |
| `apps/api/drizzle/*.sql`、`drizzle/meta/*` | migration履歴（生成物＋カスタムSQL。コミット対象） |
| `apps/api/db/admin/create-roles.sql` | `migrator` / `app_runtime`の作成（クラスタごとに1回）。パスワードはpsql変数で渡す |
| `apps/api/db/admin/grant-database.sql` | DBごとの接続・作成権限（再実行可） |
| `apps/api/src/infrastructure/database/schema/identity.ts` | Better Auth標準4表＋`allowed_google_accounts` |
| `apps/api/src/infrastructure/logging/logger.ts` | Pino設定（許可項目のserializerとredact） |
| `apps/api/src/bootstrap/configure-app.ts` | 認証経路の許可リスト → Better Auth → JSONパーサー → prefix |
| `apps/api/src/bootstrap/auth-route-allowlist.ts` | 公開4経路以外を404、POSTのOrigin必須 |
| `apps/api/src/common/domain/user-id.ts` | `UserId`ブランド型と`parse` |
| `apps/api/src/common/guard/{session,origin}.guard.ts`、`public-route.decorator.ts`、`current-user.decorator.ts` | 共通Guardとデコレーター |
| `apps/api/src/modules/identity/**` | 設計書「変更後構成」のとおり（Controller / UseCase / Adapter / Infrastructure） |
| `apps/api/src/cli/{enroll,disable}-google-account.ts` | 管理CLI |
| `packages/contracts/openapi/auth.json`、`src/me.ts` | 認証APIの契約とwire型 |
| `apps/web/src/features/auth/{ui,model,api}/*`、`index.ts` | ログインボタン・me取得・ログアウト |
| `apps/web/src/screens/sign-in/*`、`apps/web/src/app/sign-in/page.tsx` | サインイン画面（デザインv3の01・02） |
| `apps/web/src/shared/auth/auth-client.ts` | `createAuthClient`（baseURLは相対） |
| テスト一式 | docs/tests/m1-auth-onboarding.mdの配置どおり |

## 実装手順

### M1-a: DBの土台

0. **スパイク（R-2・R-4）** … 使い捨てのテストで次を確かめる。結果を設計書の「実装時確認」に書き戻し、想定と違えば先に設計を直す。
   - `npx auth@latest generate`（better-auth 1.7.xをlockfileで固定）の出力と、`pgSchema("identity")` + `modelName`複数形 + `generateId: "uuid"`の組み合わせ
   - `databaseHooks.session.create.before`が`false`を返したとき、セッション行が作られずにエラーになるか
   - `databaseHooks.account.update.before`（とcreate）でtoken列をnullにできるか
   - `accountLinking.disableImplicitLinking`相当のキーが1.7.xにあるか
   - セッショントークンのDB保存形式（ハッシュか平文か）
   - `better-auth/test`で、テストプロセス内から署名済みCookieとDBセッションを作れるか
   - 完了条件: 6項目の結果を記録し、設計の変更が要るかを判断した
1. **スキーマ定義** … `schema/identity.ts`。Better Authの生成結果を正とし、allowlistは`sql/02_auth_allowlist.sql`を移す（CHECK・UNIQUE・FK）。完了条件: `drizzle-kit generate`が差分なしで再現する
2. **migrationとロール** … `drizzle-kit generate` → レビュー。`generate --custom`でGRANT（設計書の表）と`app_runtime`の`statement_timeout = '5s'`を書く。`create-roles.sql`と`compose.yaml`。`db:generate` / `db:migrate` / `db:check`スクリプト。完了条件: 空のDBへ`db:migrate`が通り、2回目は何もしない
3. **DBテスト** … Testcontainersにロールを作ってmigrateし、スキーマ・制約・権限を検証（試験計画D-01〜D-12）。完了条件: `test:api-db`が成功

### M1-b: APIの認証

4. **UserIdとGuardの骨組み** … `user-id.ts`、`@PublicRoute`、`@CurrentUser`、`SessionVerifier` IFと結果の4値。完了条件: 単体テスト（U-01〜U-10）が成功
5. **Better Authの設定** … `better-auth.ts`（設計書の設定値。`disabledPaths`、beforeフック、DBフック）と`allowlist-query.ts`。`DATABASE_URL`が無いときは生成せず、Verifierが`unavailable`を返す。完了条件: スパイクで確かめた挙動がテストで再現する
6. **組み込み** … `auth-route-allowlist.ts`、`configure-app.ts`、`main.ts`。完了条件: 実HTTPでsign-in POSTのbody・callbackのクエリ・複数Set-Cookieが欠けない（H-01〜H-03）
7. **Guardの実装と適用** … OriginGuard（状態変更要求のOrigin完全一致 → Content-Type）、SessionGuard（Verifier → 403/401/503）。healthに`@PublicRoute`。完了条件: foundationの既存HTTPテストが「ログイン済み」前提で通り、未ログインでは401
8. **`/api/me`** … contractsのauth.json・`Me`型、Controller → GetMeUseCase → IdentityReader。完了条件: sub・メール・トークンが応答に含まれない
9. **ログ** … `nestjs-pino`とserializer・redact。例外は既知のcodeに変換。完了条件: U-17・U-18（ログに秘密が出ない）が成功

### M1-c: 管理CLI

10. **初期登録CLI** … ループバックの一時サーバー、state / PKCE / nonce、`google-auth-library`の`verifyIdToken`、確認プロンプト、1トランザクションでのINSERT。Googleとの通信部分はIFにして、テストではfakeに差し替える。完了条件: C-01〜C-07
11. **利用停止CLI** … enabled=falseとsessionsのDELETEを1トランザクションで。完了条件: C-08〜C-09

### M1-d: webと実Google確認

12. **トークンと共通スタイル** … デザインv3の色・書体・余白・角丸を`globals.css`に定義。ダークの値も定義だけする（画面の見た目は第4弾）
13. **features/auth** … `/me`をOrvalで生成し、`callApi`で呼ぶ。`useMe`、`useSignOut`、`SignInButton`（`signIn.social`、callbackURLは`/`）。完了条件: W-01〜W-08
14. **画面** … サインイン（01・02。エラー文はデザインと違う一般的な文にする。設計書「画面デザイン」参照）、ログイン後の最小ホーム（表示名・ログアウト・検証パネル）、401 → `/sign-in`、503の表示
15. **実Googleの手動確認** … ユーザーが開発用OAuthクライアントを作った後に行う。M-01〜M-07を実施し、結果をログに記録する

## 依存関係

- 0 → 1 → 2 → 3（M1-a）→ M1-b1・b2・b3（並行）→ M1-b4 → 10〜11（M1-c）→ 12〜15（M1-d）
- 5は0のスパイク結果に依存する。0で設計と違う挙動が見つかったら、設計書を直してユーザーに報告してから1へ進む
- 10は2（ロール）と5（スキーマ）に依存する
- 15はユーザーのOAuthクライアント作成に依存する。12〜14は作成前に進められる
- 生成クライアント（Orval）のimport制約は、メインの作業ツリーにある未コミットのESLint変更と関係する。その変更がmainに入ってから13に着手する

## テスト計画

docs/tests/m1-auth-onboarding.mdのとおり。配置は次のとおり。

- `apps/api/tests/{domain,guard,bootstrap,identity,logging,cli}/*.test.ts`（単体・HTTP。DBなし）
- `apps/api/tests/db/{migration,roles,auth-http,cli}.db.test.ts`（Testcontainers）
- `apps/api/tests/support/`（ロール作成・migrate・fixtureのセッション発行。本番コードからimportしない）
- `apps/web/tests/{auth-api,use-me,sign-in-screen,home-screen}.test.tsx`

## リスク

| ID | リスク | 対策 |
|---|---|---|
| R-1 | body parserとBetter Authの衝突 | 手順6で実HTTPのH-01〜H-03を先に通す |
| R-2 | DBフックやキー名が1.7.xで想定と違う | 手順0のスパイクで先に確かめ、違えば設計を直す |
| R-3 | NextのrewriteがSet-Cookieやリダイレクトを変える | 手順15の手動確認。問題があれば認証経路だけAPIへ直接リダイレクトする案をユーザーに提示 |
| R-4 | 生成スキーマと`pgSchema`の組み合わせ | 手順0で生成物を確認してからGRANTを書く |
| R-5 | CIのapi-dbジョブが長くなる | コンテナを1ファイル1回にまとめる。15分を超えたらtimeoutを見直す |
| R-6 | テスト用のセッション発行が本番に混ざる | fixtureは`tests/support`だけに置き、ESLintとレビューで本番コードからのimportを禁止する |

## ロールバック方法

- 本番環境・本番データが無いため、各PRのrevertで戻せる。
- M1-aのmigrationは、本番へ適用する前ならフォルダごと作り直してよい（ADR-0003）。

## ドキュメント更新対象

- 設計書: 手順0の結果（「実装時確認」の項目）と、usersのUPDATE権限の要否
- README: ローカルDB・ロール・migration・初期登録・OAuthクライアントの手順、登録するリダイレクトURI
- AGENTS.md / ADR: 変更なしの見込み（スパイクで方式が変わればADR-0002を更新）
- ドメインモデル文書: このリポジトリには存在しないため対象外
