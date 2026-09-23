# 設計書: m1-auth-onboarding

- ステータス: confirmed（2026-09-23 ユーザー設計承認。実装は PR #10 の後）
- レベル: L3 / ユーザー承認: 必要
- 関連: docs/requirements/m1-auth-onboarding.md / docs/decisions/ADR-0002-m1-auth-integration.md / docs/decisions/ADR-0003-m1-migration-and-db-roles.md
- 前提: docs/designs/m0-validation-result-client.md（PR #10）の実装完了
- 正本: `docs/旅行アプリ設計 3/詳細設計/03`・`02`・`08` §6・`09` §5 §8・`11`。本書はそれを M0 の実装に落とす判断をまとめたもの。業務ルールは変えない

## 背景

M0 の基盤には認証が無い。DB も検証用の `infra.m0_probes` だけである。詳細設計 03 は「Better Auth + Drizzle + DB セッション + 二人限定」を選定済みだが、NestJS への組み込み方、初期登録の方法、migration とロールの具体形は未作成である。

## 目的

要件 F-01〜F-14 を満たす最小構成を作る。M2 以降が「Guard が渡す userId を使うだけ」「migration に表を足すだけ」で進められる土台にする。

## 要件

docs/requirements/m1-auth-onboarding.md の F-01〜14、N-01〜08、E-01〜13、B-01〜05。

## 対象範囲

apps/api（identity モジュール、共通 Guard、main.ts の組み込み、Pino、DB スキーマ・migration・ロール、CLI 2 本）、apps/web（features/auth と 2 画面）、packages/contracts（auth の OpenAPI）、compose.yaml、.env.example、README。

## 対象外

業務機能（M2〜）、ログアウト時の通知停止（M5）、本番環境の作成と本番 migration の適用（M6〜M7）、Playwright E2E、オフラインのログアウト。

## 現状構成

- `main.ts` は `NestFactory.create(AppModule)` の既定設定で、Nest の JSON body parser が全経路で有効。グローバル prefix は `api`。
- `FoundationModule` は `DATABASE_URL` の有無で pg と in-memory を切り替える。`getPool()` は max 2 の単一 Pool。
- DB は `m0_probe.sql` をテストが直接流す。drizzle-kit と migration 履歴は無い。
- web は Next の rewrite で `/api/*` を 3001 へ転送する。PR #10 の実装後は、Orval 生成関数 + Zod 検証 + neverthrow の `ResultAsync` で API を呼ぶ。

## 変更後構成

```text
apps/api/
  drizzle.config.ts                     migrator 用 URL で generate / migrate
  drizzle/                              migration SQL 履歴（コミット対象）
  src/
    main.ts                             bodyParser:false → 認証経路制限 → Better Auth → json → Nest
    bootstrap/                          main.ts から呼ぶ組み込み関数（テストでも同じものを使う）
    infrastructure/
      database/pool.ts                  既存。runtime 用
      database/schema/identity.ts       Better Auth 標準表 + allowed_google_accounts
      logging/                          Pino 設定（redact・serializer）
    common/guard/
      session.guard.ts                  APP_GUARD。既定で全経路を保護
      origin.guard.ts                   APP_GUARD。状態変更要求の Origin / Content-Type
      public-route.decorator.ts         @PublicRoute()（health だけに付ける）
      current-user.decorator.ts         Guard が検証した userId を取り出す
    common/domain/
      user-id.ts                        UserId のブランド型と parse（全モジュール共通）
    modules/identity/
      identity.module.ts
      controller/me.controller.ts       GET /api/me
      usecase/get-me.usecase.ts
      adapter/inbound/get-me.input-port.ts
      adapter/outbound/session-verifier.ts        IF: Cookie 付き headers → 検証結果
      adapter/outbound/identity-reader.ts         IF: 表示名の取得
      infrastructure/better-auth.ts               betterAuth() の設定。唯一の生成箇所
      infrastructure/better-auth-session-verifier.ts
      infrastructure/pg-identity-reader.ts
      infrastructure/allowlist-query.ts           セッション発行時と Guard の共通判定
    cli/
      enroll-google-account.ts          初期登録（管理者端末専用）
      disable-google-account.ts         利用停止 + 全セッション削除
  db/admin/create-roles.sql             ロール作成（パスワードは含めない。管理手順）
apps/web/src/
  app/sign-in/page.tsx
  app/page.tsx                          ログイン後の表示（既存 home を差し替え）
  screens/sign-in/、screens/home/
  features/auth/{ui,model,api}/         ログインボタン・me 取得・ログアウト
packages/contracts/openapi/auth.json    詳細設計の openapi.auth.json を移植（/me を Orval 対象）
compose.yaml                            ローカル開発用 postgres:16-alpine
```

identity モジュールの Domain / Service 層は作らない。業務ルールが無く、詳細設計 11 §4 の「Better Auth 接続に空の Domain / Service を作る必要はない」に従う。

## データフロー

### ログイン（N-01）

1. web の /sign-in で「Google でログイン」を押す。Better Auth の React クライアントで `signIn.social({ provider: "google", callbackURL: "/" })` を呼ぶ。
2. `POST /api/auth/sign-in/social` が Next の rewrite を通って NestJS へ届く。
3. Express の経路制限ミドルウェアが「公開 4 経路のメソッドとパス」だけを通す。
4. Better Auth の before フックが body を検査する。provider が google 以外、idToken あり、callbackURL が許可リスト（`/` のみ）外なら 400。
5. Google へリダイレクトし、`GET /api/auth/callback/google` に戻る。state / PKCE の検証はライブラリが行う。
6. ライブラリが accountId=sub で既存 account を探す。disableSignUp なので未登録なら失敗する（E-01）。
7. `databaseHooks.session.create.before` で allowlist を確認する。`allowlist-query` で userId・sub・enabled が一致しなければ `false` を返し、発行を中止する（E-02、E-05）。
8. `account.updateAccountOnSignIn: false` により、ログイン時に Google の access / refresh / id token を accounts へ書き込まない。初期登録 CLI もトークンを保存しないため、トークン列は常に null になる（スパイクで確認。DB フックは使わない）。
9. Cookie を設定して `/` へリダイレクトする。web が `GET /api/me` で表示名を取得する。

### 業務 API（N-02、E-03〜E-07）

```text
要求 → OriginGuard（状態変更要求のみ: Origin 完全一致 → Content-Type）
     → SessionGuard（@PublicRoute 以外: SessionVerifier → allowlist → req に userId）
     → Controller → UseCase（userId を引数で受け取る）
```

Guard の実行順は OriginGuard → SessionGuard とする。Origin 不一致は認証状態に関係なく 403 で早く止め、DB を読まない。

SessionVerifier の結果は `authenticated(userId, expiresAt)`、`unauthenticated`、`forbidden`、`unavailable` の 4 値で表す。Guard はこれを 200 継続 / 401 / 403 / 503 に変換する。

### ログアウト（N-03）

`POST /api/auth/sign-out` は、経路制限ミドルウェアで Origin 完全一致を先に確認する。その後 Better Auth がセッション行を削除し、Cookie を失効させる。web は画面状態を消して /sign-in へ遷移する。

## API 設計

| 経路 | 公開 | 認証 | Origin | 応答 |
|---|---|---|---|---|
| POST /api/auth/sign-in/social | ○ | 不要 | 必須 | 200（リダイレクト URL）/ 400 / 403 / 503 |
| GET /api/auth/callback/google | ○ | 不要 | 対象外（state / PKCE に委ねる） | 302 / 400 / 503 |
| POST /api/auth/sign-out | ○ | 任意 | 必須 | 200 / 403 / 503 |
| GET /api/auth/error | ○ | 不要 | 対象外 | 200（一般的な説明のみ） |
| その他 /api/auth/* | × | — | — | 404 |
| GET /api/me | ○ | 必須 | 対象外（GET） | 200 `Me` / 401 / 403 / 503 |
| GET /api/health | ○ | 不要（@PublicRoute） | 対象外 | 200（変更なし） |
| /api/foundation/* | ○ | 必須（新規） | POST は必須 | 既存 + 401 / 403 |

- 契約は詳細設計の `openapi.auth.json`（5 操作、`Me` スキーマ）を `packages/contracts/openapi/auth.json` へ移植する。Orval は `/me` だけを生成対象にする。認証経路は Better Auth クライアントが呼ぶため、生成しない。
- エラー body は既存 `Error` スキーマ（code と一般的な message）に揃える。Guard が返す code は `UNAUTHENTICATED`、`FORBIDDEN_NOT_ALLOWED`、`FORBIDDEN_ORIGIN`、`UNSUPPORTED_MEDIA_TYPE`、`AUTH_UNAVAILABLE` とする。
- 経路の二重防御として、Better Auth 側でも `disabledPaths` に既知の非公開経路（get-session、list-sessions、list-accounts、link-social、unlink-account、delete-user、update-user、revoke-session(s)、refresh-token、get-access-token など）を列挙する。主の防御は経路制限ミドルウェアの許可リストとする。

## DB 設計

`identity` スキーマに次を置く。列名・型は Better Auth 1.7.x の `auth generate` の結果を正とする。推測の DDL で置き換えない。

| 表 | 主な列・制約 | 備考 |
|---|---|---|
| identity.users | id uuid PK、name、email、email_verified、image、created_at、updated_at | `advanced.database.generateId: "uuid"`。業務の外部キー共通 UUID |
| identity.accounts | id、user_id FK、provider_id、account_id（= sub）、トークン列、created_at、updated_at。UNIQUE(provider_id, account_id) | トークン列は常に null（`updateAccountOnSignIn: false`）。UNIQUE は生成物に無いので自分で追加する |
| identity.sessions | id、user_id FK、token、expires_at、ip_address、user_agent、created_at、updated_at | token は**平文で保存**される（1.7.5 で確認）。Cookie の値は、この token に署名を付けたもの |
| identity.verifications | id、identifier、value、expires_at | OAuth の一時データ |
| identity.allowed_google_accounts | slot smallint PK CHECK(0,1)、user_id uuid UNIQUE FK、google_sub text UNIQUE CHECK(1〜255)、enabled bool、created_at | `sql/02_auth_allowlist.sql` をそのまま Drizzle へ |

Better Auth の表名は `modelName`（users / accounts / sessions / verifications）で複数形に揃える。スキーマは Drizzle の `pgSchema("identity")` で定義し、adapter に schema オブジェクトを渡す。

migration とロールは ADR-0003 のとおりとする。

- `drizzle-kit generate` で SQL を作り、レビューしてコミットする。GRANT などのカスタム SQL は `drizzle-kit generate --custom` の空 migration に手で書く。
- 適用は `drizzle-kit migrate`（`MIGRATION_DATABASE_URL`）。アプリ起動時・CI の PR ジョブで本番へ適用することはしない。
- `app_runtime` への GRANT（M1 分）:

| 表 | 権限 |
|---|---|
| identity.users | SELECT、列単位の UPDATE(email_verified, updated_at)。ログイン時に Better Auth が email_verified を true にする場合があるため（スパイクで確認） |
| identity.accounts | SELECT, UPDATE |
| identity.sessions | SELECT, INSERT, UPDATE, DELETE |
| identity.verifications | SELECT, INSERT, UPDATE, DELETE |
| identity.allowed_google_accounts | SELECT のみ |

users / accounts / allowlist への INSERT は、初期登録 CLI（管理者接続）だけが行う。`infra.m0_probes` は migration に含めない（未決事項 1）。

## フロントエンド設計

- `features/auth/api`: `/me` は PR #10 の方式（Orval 生成 + Zod + `ResultAsync`）で呼ぶ。401 は `ApiFailure` の http(401) として判別する。
- `features/auth/model`: `useMe()`（取得状態）と `useSignOut()`。サインアウト成功時に画面状態を消す。
- `features/auth/ui`: `SignInButton`（`better-auth/react` の `createAuthClient` → `signIn.social`）、`SignOutButton`。`useSession` は使わない（公開 get-session に依存しないため）。
- `app/sign-in/page.tsx` → `screens/sign-in`。`app/page.tsx` → `screens/home`（表示名 + ログアウト + 既存の foundation 検証パネル）。401 なら `/sign-in` へ `router.replace`。元の操作は自動再送しない。
- Better Auth クライアントの baseURL は同一オリジン（相対）とする。web に秘密値や DB 接続を置かない。
- Next の `/api` rewrite は既存のものを使う。複数 Set-Cookie とリダイレクトが rewrite を通って欠けないことを結合確認する（リスク R-3）。

## バックエンド設計

### main.ts の組み込み順（ADR-0002）

```ts
const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
const http = app.getHttpAdapter().getInstance();
http.use("/api/auth", authRouteAllowlist(publicOrigin));   // 4 経路以外は 404。POST は Origin 必須
http.all("/api/auth/*splat", toNodeHandler(auth));        // Express 5 の書式
app.useBodyParser("json");                                 // 認証経路の後で Nest 用に有効化
app.setGlobalPrefix("api");
```

- 上記は `bootstrap/configure-app.ts` にまとめる。main.ts と HTTP テストの両方から同じ関数を呼び、テストと本番の組み込みがずれないようにする。
- `auth` は DI 管理外で生成する。`better-auth.ts` の `createAuth(config, pool)` を使い、IdentityModule にも同じインスタンスを provider として渡す。
- `DATABASE_URL` が無いとき: 認証経路と Guard は 503 を返す（in-memory の認証は作らない）。/api/health は動く。

### Better Auth 設定（要点）

```ts
betterAuth({
  baseURL: env.PUBLIC_APP_ORIGIN, basePath: "/api/auth",
  trustedOrigins: [env.PUBLIC_APP_ORIGIN],
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema: identitySchema }),
  emailAndPassword: { enabled: false },
  socialProviders: { google: { clientId, clientSecret, disableSignUp: true, disableImplicitSignUp: true } },
  account: { accountLinking: { enabled: false } },
  session: { expiresIn: 60 * 60 * 24 * 7, disableSessionRefresh: true, cookieCache: { enabled: false } },
  advanced: { cookiePrefix: "travel", useSecureCookies: isProduction, database: { generateId: "uuid" } },
  disabledPaths: [/* 非公開経路 */],
  hooks: { before: /* sign-in/social の body 検査 */ },
  databaseHooks: { session: { create: { before: /* allowlist */ } }, account: { update: { before: /* token null */ } } },
});
```

- キー名は調査時点（1.7.5）の公式ドキュメントで確認した。実装時に lockfile の版で再確認する。
- `accountLinking.disableImplicitLinking` 相当のキーが 1.7.x に存在するかは、実装時に確認する。

### 共通 Guard

- `SessionGuard` と `OriginGuard` を `APP_GUARD` で全体に適用する。保護を既定にし、公開は `@PublicRoute()` で明示する。
- 付け忘れても安全側に倒れる（業務 API を追加したときに Guard を忘れても 401 になる）。
- UseCase は userId を普通の引数で受け取り、Nest や Better Auth の型に依存しない。

### 値オブジェクトの方針（UserId）

値オブジェクトは、不変条件を持つ値にだけ作る（詳細設計 11 §2「必要箇所へ適用」）。M1 で作るのは `UserId` だけとする。

- 形: ブランド型 `type UserId = string & { readonly __brand: "UserId" }` と、生成関数 `UserId.parse(value: string): UserId` を置く。parse は UUID 形式でなければ例外を投げる。クラスにはしない。
- 置き場所: `apps/api/src/common/domain/user-id.ts`。Guard と、M2 以降の全モジュールの Domain / UseCase から参照する。業務の判断は置かず、この型だけを置く。パスが既存 ESLint の `apps/api/src/**/domain/**` に当たるため、Domain と同じ制約（NestJS・DB・他区分へ依存しない）が自動で適用される。
- 生成するのは 2 か所だけにする。`SessionVerifier` の実装（検証済みセッションから）と、Infrastructure が DB 行を変換するときである。Controller は request body の値から UserId を作らない。
- 目的: `tripId`・`planId`・支払者の userId などとの取り違えを、コンパイル時に検出する。操作者と支払者を型で区別できるのは M3 の前提になる。
- 作らないもの: email・displayName（表示と保存だけで、アプリは判断に使わない）、Google sub（初期登録 CLI と許可リストの判定の中だけで使い、ID トークンの検証と DB の CHECK で守られる）。slot は `0 | 1` の型で足りる。
- テスト: `UserId.parse` の単体テストを書く（正しい UUID、形式違い、空文字）。

### CLI（ADR-0002）

`enroll-google-account --slot 0|1`:

1. `MIGRATION_DATABASE_URL`（管理者接続）と、初期登録専用の Google OAuth クライアント（デスクトップ型）を環境変数から読む。
2. `127.0.0.1` のランダムポートで一時サーバーを起動する。state / PKCE / nonce を生成して認可 URL を表示し、管理者がブラウザで開く。
3. callback で state を照合する。code を交換し、`google-auth-library` の `verifyIdToken` で署名・iss・aud・exp・nonce を検証する。
4. 表示名・メール・sub の末尾 4 文字を表示し、管理者が `yes` と入力したら 1 トランザクションで users → accounts（トークン列なし）→ allowlist を INSERT する。slot / sub の重複は制約違反としてロールバックする。
5. トークンは破棄し、ログやファイルに書かない。一時サーバーは 1 回の callback を受けたら閉じる。タイムアウトは 5 分。

`disable-google-account --slot 0|1`: 1 トランザクションで allowlist.enabled=false と、その user_id の sessions の DELETE を行う。

どちらも `apps/api/src/cli/` に置き、Nest の AppModule と HTTP ルートには登録しない。

## エラー処理

外部 I/O（Google OAuth、PostgreSQL）を含むため、5 項目を定める。

- (a) リトライ: サーバー側の自動リトライはしない（詳細設計 08 の初期方針）。ログインは利用者の再操作で再試行する。CLI も失敗時は中止して再実行する。
- (b) タイムアウト: pg Pool の `connectionTimeoutMillis` 10 秒（既存）。認証クエリにはロール単位の `statement_timeout` を初期値 5 秒で設定する（ロール作成手順に含める）。Google への通信はライブラリの既定に従う。CLI の callback 待ちは 5 分。
- (c) 冪等性: ログイン・ログアウトは何度実行しても安全（ログアウト済みでも 200 で Cookie 消去。B-03）。初期登録 CLI は一意制約で二重登録を拒否する。利用停止 CLI は再実行しても同じ結果になる。
- (d) 部分失敗: 初期登録と利用停止は 1 トランザクションで行い、途中失敗は全ロールバックする。セッション発行の中止はフックの `false` によりライブラリがロールバックする（実装時に DB へ行が残らないことをテストで確認する）。
- (e) フォールバック: 認証 DB に接続できないときは 503 とし、Cookie は消さない。web は「一時的に利用できません」と表示し、再試行ボタンを出す。401 と混同して /sign-in へ飛ばさない。

## ログと監視

- `nestjs-pino`（Nest の logger adapter）+ `pino-http` を使う。1 要求 1 行で、出す項目は requestId、method、path（クエリを除く）、statusCode、responseTime、code（Guard の結果コード）に限る。
- redact の対象は `req.headers.cookie`、`req.headers.authorization`、`res.headers["set-cookie"]`、`*.token`、`*.accessToken`、`*.idToken`、`*.refreshToken`、`*.code`、`*.sub`。redact は防御の二重化とし、主の対策は「許可した項目だけを出す serializer」とする。
- callback のクエリ（code / state）は path から落とす。例外の message / stack は既知の code に変換して出す。
- 認証の拒否は warn にしない（第三者のアクセスは正常に起こりうる）。info で code だけを出す。503 は error とする。
- 監視基盤の追加はしない（詳細設計 09 の初期方針）。

## セキュリティ

- 公開経路は許可リスト方式（F-06）。Better Auth の `disabledPaths` で二重に防御する。
- セッションは DB で検証し、Cookie キャッシュは使わない。利用許可は発行時と毎要求の 2 か所で確認する。発行時の判定と Guard の判定は同じ `allowlist-query` を使い、ずれを防ぐ。
- CSRF: SameSite=Lax、状態変更要求の Origin 完全一致、JSON の Content-Type 必須。CORS は設定しない（別オリジンからの資格情報付き要求を許可しない）。
- 秘密値は環境変数だけに置く（`BETTER_AUTH_SECRET`、`GOOGLE_CLIENT_SECRET`、`ENROLL_GOOGLE_CLIENT_SECRET`、DB URL）。`.env.example` には名前だけを書く。`NEXT_PUBLIC_*` に秘密を置かない。
- 最小権限: app_runtime は allowlist を SELECT だけ。DDL・TRUNCATE は不可。
- テスト用のセッション発行はテストコード内だけで行う。本番コードに環境変数で有効になる裏口を作らない。
- 実装後に security-reviewer を必ず通す（L3 で認証を扱うため、省略しない）。

## 性能

二人の利用で、要求ごとに DB 参照が 2 回（セッションと allowlist）増える程度。目標値は設けない（対象外）。Pool の max 2 は維持し、M6 で実測する。

## テスト方針

詳細は承認後に試験計画（docs/tests/m1-auth-onboarding.md）で作る。ここでは層と手段だけを決める。

| 層 | 手段 | 主な対象 |
|---|---|---|
| 単体 | Vitest | GetMeUseCase、Guard（SessionVerifier を fake 化）、経路制限ミドルウェア、ログ serializer |
| HTTP + 実 DB | Supertest + Testcontainers（test:api-db） | `configure-app` で組んだ実アプリに、N-02〜03、E-03〜E-10 を実行する |
| セッション発行 | `better-auth/plugins` の `testUtils` をテスト時だけ auth に追加し、`login({ userId })` で DB フックを通った正規のセッションと署名 Cookie を作る。本番の設定には入れない（`createAuth` の引数でテストからだけ渡し、ESLint で src からの `testUtils` の import を禁止する） | 二人・第三者・停止・sub 不一致・期限切れ |
| DB 権限 | Testcontainers にロールを作り、app_runtime で接続 | N-06、N-07、E-13（T-18 の identity 分） |
| migration | 空 DB に適用して再適用 | N-06 |
| CLI | Google 部分を fake にした単体 + 実 DB の TX 検証 | E-11、E-12、F-10 |
| web | Vitest + Testing Library | サインイン画面、me の表示、401 で遷移、503 表示 |
| 手動 | ローカルの実 Google | N-01、N-04、E-01、Set-Cookie が rewrite を通ること。結果をログへ記録 |

CI には Google の実通信を入れない。fixture が通ったことを「Google OAuth の成功」と報告しない（詳細設計 09 §5）。

## 移行とリリース

- 本番環境が無いため、M1 のリリースは main へのマージだけとなる。本番 migration の適用と初期登録は M7 で行う。
- ローカル: `docker compose up -d` → `db/admin/create-roles.sql` → `npm run db:migrate -w @tomotabi/api` → `enroll` で二人を登録 → `dev:api` / `dev:web`。README に手順を書く。
- CI: 既存の api-db ジョブで、Testcontainers 上に migration の適用と権限テストを追加する。本番の secret は CI に渡さない。
- ロールバック: main の PR を revert すれば戻せる（本番データが無いため）。

## スパイクの結果（2026-09-24、better-auth 1.7.5・drizzle-kit 0.31.11・PostgreSQL 16）

| 確認項目 | 結果 | 設計への反映 |
|---|---|---|
| 生成スキーマ | `npx auth generate` は `pgTable`（public）で出力する。`pgSchema("identity")` に書き換えても adapter と `getSession` は動作した。accounts に UNIQUE(provider_id, account_id) は無い。日時はタイムゾーンなし | identity スキーマへ書き換え、UNIQUE を追加し、日時は `timestamptz` にする |
| `session.create.before` が `false` | セッション行は作られず、`createSession` が null を返す。OAuth callback では「unable to create session」のエラーとして扱われ、500 にはならない | 設計どおり。E-01・E-02・E-05 の発行拒否はこのフックで行う |
| Google のトークン | `account.updateAccountOnSignIn: false` で、ログイン時の account 更新が空になる | account の DB フックは不要。設定だけで足りる |
| 暗黙のアカウント連携 | `account.accountLinking.disableImplicitLinking` は 1.7.5 に存在する | `enabled: false` と併用する |
| セッショントークン | DB に平文で保存される（Cookie の値の署名なし部分と同じ） | リスク R-7 に追加 |
| テスト用のセッション発行 | `testUtils` プラグインの `login({ userId })` で、DB フックを通った正規のセッションと署名 Cookie（`travel.session_token`、HttpOnly、Lax、Path=/）ができる。有効期間は 7 日 | テスト方針に反映 |
| users の更新 | ログイン時、Google 側が確認済みで DB の email_verified が false なら true に更新する。表示名などは既定で上書きしない | users の UPDATE は列単位（email_verified, updated_at）に絞る。初期登録 CLI は ID トークンの email_verified を保存する |

## リスク

| ID | リスク | 対策 |
|---|---|---|
| R-1 | Better Auth と Nest の body parser の組み合わせで、認証 body や callback が壊れる | `configure-app` を実 HTTP テストで確認する。sign-in POST・callback のクエリ・複数 Set-Cookie を検証する |
| R-2 | 1.7.x の DB フックやキー名が想定と違う（`false` での中止、account フック、disableImplicitLinking） | 実装の最初のステップで小さなスパイクテストを書いて確認する。違えば設計を更新してから進める |
| R-3 | Next の rewrite がリダイレクトや複数 Set-Cookie を変える | ローカルの実 Google 手動確認で検証する。問題があれば、認証経路だけ API へ直接リダイレクトする案を検討してユーザーに報告する |
| R-4 | 生成スキーマの uuid 設定と Drizzle の pgSchema の組み合わせが通らない | 生成物を先に確認してから GRANT を書く |
| R-5 | コミュニティ製ではなく公式方式を選ぶため、Guard などを自前で書く量が増える | Guard 2 つと経路制限だけに限定する。ADR-0002 に比較を残す |
| R-6 | 開発用 OAuth クライアントの設定ミス（redirect URI） | README に登録すべき URI を正確に書く |
| R-7 | セッショントークンが DB に平文で保存される。DB の内容と署名鍵の両方が漏れると、セッションを乗っ取れる | DB の接続情報と署名鍵を別々に管理する（どちらか一方だけでは乗っ取れない）。有効期間 7 日・自動延長なし。利用停止 CLI で全セッションを即時削除できる。Better Auth の標準機能にハッシュ化が無いため、M1 では行わない（ユーザー確認事項） |

## 未決事項

1. `infra.m0_probes` と /api/foundation/* を、いつ撤去するか。本設計では M1 でログイン必須にし、テスト用 SQL のまま残す。M2 の開始時に撤去する案を推奨する。
2. （解決済み）セッションは 7 日・自動延長なしで確定（2026-09-23 ユーザー決定）。
3. （解決済み）Better Auth の採用は 2026-09-23 の設計承認で確定。
4. （解決済み）実装時確認は 2026-09-24 のスパイクで完了。結果は「スパイクの結果」節。
6. ユーザー確認: セッショントークンが DB に平文で保存されることを受け入れるか（リスク R-7）。
5. 前提: PR #10 の承認と実装が先に完了すること。
