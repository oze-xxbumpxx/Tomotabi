# 設計書: m1-auth-onboarding

- ステータス: confirmed（2026-09-23ユーザー設計承認。実装はPR #10の後）
- レベル: L3 / ユーザー承認: 必要
- 関連: docs/requirements/m1-auth-onboarding.md / docs/decisions/ADR-0002-m1-auth-integration.md / docs/decisions/ADR-0003-m1-migration-and-db-roles.md
- 前提: docs/designs/m0-validation-result-client.md（PR #10）の実装完了
- 正本: `docs/旅行アプリ設計 3/詳細設計/03`・`02`・`08` §6・`09` §5 §8・`11`。本書はそれをM0の実装に落とす判断をまとめたもの。業務ルールは変えない

## 背景

M0の基盤には認証が無い。DBも検証用の`infra.m0_probes`だけである。詳細設計03は「Better Auth + Drizzle + DBセッション + 二人限定」を選定済みだが、NestJSへの組み込み方、初期登録の方法、migrationとロールの具体形は未作成である。

## 目的

要件F-01〜F-14を満たす最小構成を作る。M2以降が「Guardが渡すuserIdを使うだけ」「migrationに表を足すだけ」で進められる土台にする。

## 要件

docs/requirements/m1-auth-onboarding.mdのF-01〜14、N-01〜08、E-01〜13、B-01〜05。

## 対象範囲

apps/api（identityモジュール、共通Guard、main.tsの組み込み、Pino、DBスキーマ・migration・ロール、CLI 2本）、apps/web（features/authと2画面）、packages/contracts（authのOpenAPI）、compose.yaml、.env.example、README。

## 対象外

業務機能（M2〜）、ログアウト時の通知停止（M5）、本番環境の作成と本番migrationの適用（M6〜M7）、Playwright E2E、オフラインのログアウト。

## 現状構成

- `main.ts`は`NestFactory.create(AppModule)`の既定設定で、NestのJSON body parserが全経路で有効。グローバルprefixは`api`。
- `FoundationModule`は`DATABASE_URL`の有無でpgとin-memoryを切り替える。`getPool()`はmax 2の単一Pool。
- DBは`m0_probe.sql`をテストが直接流す。drizzle-kitとmigration履歴は無い。
- webはNextのrewriteで`/api/*`を3001へ転送する。PR #10の実装後は、Orval生成関数 + Zod検証 + neverthrowの`ResultAsync`でAPIを呼ぶ。

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
  db/admin/create-roles.sql             ロール作成（クラスタごとに 1 回。パスワードは含めない。管理手順）
  db/admin/grant-database.sql           DB ごとの接続・作成権限（再実行可。管理手順）
apps/web/src/
  app/sign-in/page.tsx
  app/page.tsx                          ログイン後の表示（既存 home を差し替え）
  screens/sign-in/、screens/home/
  features/auth/{ui,model,api}/         ログインボタン・me 取得・ログアウト
packages/contracts/openapi/auth.json    詳細設計の openapi.auth.json を移植（/me を Orval 対象）
compose.yaml                            ローカル開発用 postgres:16-alpine
```

identityモジュールのDomain / Service層は作らない。業務ルールが無く、詳細設計11 §4の「Better Auth接続に空のDomain / Serviceを作る必要はない」に従う。

## データフロー

### ログイン（N-01）

1. webの /sign-inで「Googleでログイン」を押す。Better AuthのReactクライアントで`signIn.social({ provider: "google", callbackURL: "/" })`を呼ぶ。
2. `POST /api/auth/sign-in/social`がNextのrewriteを通ってNestJSへ届く。
3. Expressの経路制限ミドルウェアが「公開3経路のメソッドとパス」だけを通す。
4. Better Authのbeforeフックがbodyを検査する。providerがgoogle以外、idTokenあり、callbackURLが許可リスト（`/`のみ）外、errorCallbackURL / newUserCallbackURLの指定ありなら400（戻り先はサーバー側の設定だけで決め、open redirectを作らない）。

5. Googleへリダイレクトし、`GET /api/auth/callback/google`に戻る。state / PKCEの検証はライブラリが行う。
6. ライブラリがaccountId=subで既存accountを探す。disableSignUpなので未登録なら失敗する（E-01）。
7. `databaseHooks.session.create.before`でallowlistを確認する。`allowlist-query`でuserId・sub・enabledが一致しなければ`false`を返し、発行を中止する（E-02、E-05）。
8. `account.updateAccountOnSignIn: false`により、ログイン時にGoogleのaccess / refresh / id tokenをaccountsへ書き込まない。初期登録CLIもトークンを保存しないため、トークン列は常にnullになる（スパイクで確認。DBフックは使わない）。
9. Cookieを設定して`/`へリダイレクトする。webが`GET /api/me`で表示名を取得する。

途中で失敗したとき（state不一致・コード交換失敗・未登録・許可リスト拒否など）は、ライブラリが`onAPIError.errorURL`に設定した`<公開アプリのオリジン>/sign-in?error=…`へ302で戻す。webの /sign-inが`?error=`の有無で原因を問わない一般的な文を出す（W-03）。ライブラリの既定の戻り先`GET /api/auth/error`は使わず、経路制限で404にする。

### 業務API（N-02、E-03〜E-07）

```text
要求 → OriginGuard（状態変更要求のみ: Origin 完全一致 → Content-Type）
     → SessionGuard（@PublicRoute 以外: SessionVerifier → allowlist → req に userId）
     → Controller → UseCase（userId を引数で受け取る）
```

Guardの実行順はOriginGuard → SessionGuardとする。Origin不一致は認証状態に関係なく403で早く止め、DBを読まない。

SessionVerifierの結果は`authenticated(userId, expiresAt)`、`unauthenticated`、`forbidden`、`unavailable`の4値で表す。Guardはこれを200継続 / 401 / 403 / 503に変換する。

### ログアウト（N-03）

`POST /api/auth/sign-out`は、経路制限ミドルウェアでOrigin完全一致を先に確認する。その後Better Authがセッション行を削除し、Cookieを失効させる。webは画面状態を消して /sign-inへ遷移する。

## API設計

| 経路 | 公開 | 認証 | Origin | 応答 |
|---|---|---|---|---|
| POST /api/auth/sign-in/social | ○ | 不要 | 必須 | 200（リダイレクトURL）/ 400 / 403 / 503 |
| GET /api/auth/callback/google | ○ | 不要 | 対象外（state / PKCEに委ねる） | 302 / 400 / 503 |
| POST /api/auth/sign-out | ○ | 任意 | 必須 | 200 / 403 / 503 |
| その他 /api/auth/*（GET /api/auth/errorを含む） | × | — | — | 404 |
| GET /api/me | ○ | 必須 | 対象外（GET） | 200 `Me` / 401 / 403 / 503 |
| GET /api/health | ○ | 不要（@PublicRoute） | 対象外 | 200（変更なし） |
| /api/foundation/* | ○ | 必須（新規） | POSTは必須 | 既存 + 401 / 403 |

- 契約は詳細設計の`openapi.auth.json`（5操作、`Me`スキーマ）を`packages/contracts/openapi/auth.json`へ移植する。Orvalは`/me`だけを生成対象にする。認証経路はBetter Authクライアントが呼ぶため、生成しない。
- エラーbodyは既存`Error`スキーマ（codeと一般的なmessage）に揃える。Guardが返すcodeは`UNAUTHENTICATED`、`FORBIDDEN_NOT_ALLOWED`、`FORBIDDEN_ORIGIN`、`UNSUPPORTED_MEDIA_TYPE`、`AUTH_UNAVAILABLE`とする。
- 経路の二重防御として、Better Auth側でも`disabledPaths`に既知の非公開経路（get-session、list-sessions、list-accounts、link-social、unlink-account、delete-user、update-user、revoke-session(s)、refresh-token、get-access-tokenなど）を列挙する。主の防御は経路制限ミドルウェアの許可リストとする。

## DB設計

`identity`スキーマに次を置く。列名・型はBetter Auth 1.7.xの`auth generate`の結果を正とする。推測のDDLで置き換えない。

| 表 | 主な列・制約 | 備考 |
|---|---|---|
| identity.users | id uuid PK、name、email、email_verified、image、created_at、updated_at | `advanced.database.generateId: "uuid"`。業務の外部キー共通UUID |
| identity.accounts | id、user_id FK、provider_id、account_id（= sub）、トークン列、created_at、updated_at。UNIQUE(provider_id, account_id) | トークン列は常にnull（`updateAccountOnSignIn: false`）。UNIQUEは生成物に無いので自分で追加する |
| identity.sessions | id、user_id FK、token、expires_at、ip_address、user_agent、created_at、updated_at | tokenは**平文で保存**される（1.7.5で確認）。Cookieの値は、このtokenに署名を付けたもの |
| identity.verifications | id、identifier、value、expires_at | OAuthの一時データ |
| identity.allowed_google_accounts | slot smallint PK CHECK(0,1)、user_id uuid UNIQUE FK、google_sub text UNIQUE CHECK(1〜255)、enabled bool、created_at | `sql/02_auth_allowlist.sql`をそのままDrizzleへ |

Better Authの表名は`modelName`（users / accounts / sessions / verifications）で複数形に揃える。スキーマはDrizzleの`pgSchema("identity")`で定義し、adapterにschemaオブジェクトを渡す。

migrationとロールはADR-0003のとおりとする。

- `drizzle-kit generate`でSQLを作り、レビューしてコミットする。GRANTなどのカスタムSQLは`drizzle-kit generate --custom`の空migrationに手で書く。
- 適用は`drizzle-kit migrate`（`MIGRATION_DATABASE_URL`）。アプリ起動時・CIのPRジョブで本番へ適用することはしない。
- `app_runtime`へのGRANT（M1分）:

| 表 | 権限 |
|---|---|
| identity.users | SELECT、列単位のUPDATE(email_verified, updated_at)。ログイン時にBetter Authがemail_verifiedをtrueにする場合があるため（スパイクで確認） |
| identity.accounts | SELECTのみ（`updateAccountOnSignIn: false`のため、ログインで更新しない） |
| identity.sessions | SELECT, INSERT, UPDATE, DELETE |
| identity.verifications | SELECT, INSERT, UPDATE, DELETE |
| identity.allowed_google_accounts | SELECTのみ |

users / accounts / allowlistへのINSERTは、初期登録CLI（管理者接続）だけが行う。`infra.m0_probes`はmigrationに含めない（未決事項1）。

## フロントエンド設計

- `features/auth/api`: `/me`はPR #10の方式（Orval生成 + Zod + `ResultAsync`）で呼ぶ。401は`ApiFailure`のhttp(401)として判別する。
- `features/auth/model`: `useMe()`（取得状態）と`useSignOut()`。サインアウト成功時に画面状態を消す。
- `features/auth/ui`: `SignInButton`（`better-auth/react`の`createAuthClient` → `signIn.social`）、`SignOutButton`。`useSession`は使わない（公開get-sessionに依存しないため）。
- `app/sign-in/page.tsx` → `screens/sign-in`。`app/page.tsx` → `screens/home`（表示名 + ログアウト + 既存のfoundation検証パネル）。401なら`/sign-in`へ`router.replace`。元の操作は自動再送しない。
- Better AuthクライアントのbaseURLは同一オリジン（相対）とする。webに秘密値やDB接続を置かない。
- Nextの`/api` rewriteは既存のものを使う。複数Set-Cookieとリダイレクトがrewriteを通って欠けないことを結合確認する（リスクR-3）。

### 画面デザイン（Claude Design v3）

- 見た目の参照はClaude Designのhandoff `design_handoff_tomotabi_v3`（2026-09-24レビュー済み。リポジトリの`docs/design/handoff-v3/`に置いた。主な参照先は`Tomotabi 画面一式 v3.dc.html`で、`support.js`と同じフォルダのままブラウザで開く）の01・02（サインイン）と03〜07（ホーム）、20〜22（ログイン切れ・開けない・オフライン）。トークンはREADMEのCSSカスタムプロパティ名をそのまま使う。
- **デザインから変える点: 02サインインのエラー文。** v3は「ログインできませんでした。このアカウントでは利用できません。別のGoogleアカウントでお試しください。」だが、実装では原因を問わない一般的な文にする（例:「ログインできませんでした。時間をおいて、もう一度お試しください。」）。
  - 理由1: 詳細設計03 §8と要件E-01は、エラー表示を一般的な説明だけにすると定めている。v3の文は、許可リストで拒否されたことを第三者に示してしまう。
  - 理由2: このエラーは通信失敗やOAuthの途中失敗（state不一致など）でも出る。そのとき「このアカウントでは利用できません」は事実と合わない。
  - 配置（ボタン直上の赤文字13px、ロゴの位置は動かさない）はデザインどおりとする。

## バックエンド設計

### main.tsの組み込み順（ADR-0002）

```ts
const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
const http = app.getHttpAdapter().getInstance();
http.use("/api/auth", authRouteAllowlist(publicOrigin));   // 3 経路以外は 404。POST は Origin 必須
http.all("/api/auth/*splat", toNodeHandler(auth));        // Express 5 の書式
app.useBodyParser("json");                                 // 認証経路の後で Nest 用に有効化
app.setGlobalPrefix("api");
```

- 上記は`bootstrap/configure-app.ts`にまとめる。main.tsとHTTPテストの両方から同じ関数を呼び、テストと本番の組み込みがずれないようにする。
- `auth`はDI管理外で生成する。`better-auth.ts`の`createAuth(config, pool)`を使い、IdentityModuleにも同じインスタンスをproviderとして渡す。
- `DATABASE_URL`が無いとき: 認証経路とGuardは503を返す（in-memoryの認証は作らない）。/api/healthは動く。

### Better Auth設定（要点）

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
  onAPIError: { errorURL: `${env.PUBLIC_APP_ORIGIN}/sign-in` },
  hooks: { before: /* sign-in/social の body 検査 */ },
  databaseHooks: { session: { create: { before: /* allowlist */ } }, account: { update: { before: /* token null */ } } },
});
```

- キー名は調査時点（1.7.5）の公式ドキュメントで確認した。実装時にlockfileの版で再確認する。
- `accountLinking.disableImplicitLinking`相当のキーが1.7.xに存在するかは、実装時に確認する。

### 共通Guard

- `SessionGuard`と`OriginGuard`を`APP_GUARD`で全体に適用する。保護を既定にし、公開は`@PublicRoute()`で明示する。
- 付け忘れても安全側に倒れる（業務APIを追加したときにGuardを忘れても401になる）。
- UseCaseはuserIdを普通の引数で受け取り、NestやBetter Authの型に依存しない。

### 値オブジェクトの方針（UserId）

値オブジェクトは、不変条件を持つ値にだけ作る（詳細設計11 §2「必要箇所へ適用」）。M1で作るのは`UserId`だけとする。

- 形: ブランド型`type UserId = string & { readonly __brand: "UserId" }`と、生成関数`UserId.parse(value: string): UserId`を置く。parseはUUID形式でなければ例外を投げる。クラスにはしない。
- 置き場所: `apps/api/src/common/domain/user-id.ts`。Guardと、M2以降の全モジュールのDomain / UseCaseから参照する。業務の判断は置かず、この型だけを置く。パスが既存ESLintの`apps/api/src/**/domain/**`に当たるため、Domainと同じ制約（NestJS・DB・他区分へ依存しない）が自動で適用される。
- 生成するのは2か所だけにする。`SessionVerifier`の実装（検証済みセッションから）と、InfrastructureがDB行を変換するときである。Controllerはrequest bodyの値からUserIdを作らない。
- 目的: `tripId`・`planId`・支払者のuserIdなどとの取り違えを、コンパイル時に検出する。操作者と支払者を型で区別できるのはM3の前提になる。
- 作らないもの: email・displayName（表示と保存だけで、アプリは判断に使わない）、Google sub（初期登録CLIと許可リストの判定の中だけで使い、IDトークンの検証とDBのCHECKで守られる）。slotは`0 | 1`の型で足りる。
- テスト: `UserId.parse`の単体テストを書く（正しいUUID、形式違い、空文字）。

### CLI（ADR-0002）

`enroll-google-account --slot 0|1`:

1. `MIGRATION_DATABASE_URL`（管理者接続）と、初期登録専用のGoogle OAuthクライアント（デスクトップ型）を環境変数から読む。
2. `127.0.0.1`のランダムポートで一時サーバーを起動する。state / PKCE / nonceを生成して認可URLを表示し、管理者がブラウザで開く。
3. callbackでstateを照合する。codeを交換し、`google-auth-library`の`verifyIdToken`で署名・iss・aud・exp・nonceを検証する。
4. 表示名・メール・subの末尾4文字を表示し、管理者が`yes`と入力したら1トランザクションでusers → accounts（トークン列なし）→ allowlistをINSERTする。slot / subの重複は制約違反としてロールバックする。
5. トークンは破棄し、ログやファイルに書かない。一時サーバーは1回のcallbackを受けたら閉じる。タイムアウトは5分。

`disable-google-account --slot 0|1`: 1トランザクションでallowlist.enabled=falseと、そのuser_idのsessionsのDELETEを行う。

どちらも`apps/api/src/cli/`に置き、NestのAppModuleとHTTPルートには登録しない。

## エラー処理

外部I/O（Google OAuth、PostgreSQL）を含むため、5項目を定める。

- (a)リトライ: サーバー側の自動リトライはしない（詳細設計08の初期方針）。ログインは利用者の再操作で再試行する。CLIも失敗時は中止して再実行する。
- (b)タイムアウト: pg Poolの`connectionTimeoutMillis` 10秒（既存）。認証クエリにはロール単位の`statement_timeout`を初期値5秒で設定する（ロール作成手順に含める）。Googleへの通信はライブラリの既定に従う。CLIのcallback待ちは5分。
- (c)冪等性: ログイン・ログアウトは何度実行しても安全（ログアウト済みでも200でCookie消去。B-03）。初期登録CLIは一意制約で二重登録を拒否する。利用停止CLIは再実行しても同じ結果になる。
- (d)部分失敗: 初期登録と利用停止は1トランザクションで行い、途中失敗は全ロールバックする。セッション発行の中止はフックの`false`によりライブラリがロールバックする（実装時にDBへ行が残らないことをテストで確認する）。
- (e)フォールバック: 認証DBに接続できないときは503とし、Cookieは消さない。webは「一時的に利用できません」と表示し、再試行ボタンを出す。401と混同して /sign-inへ飛ばさない。

## ログと監視

- `nestjs-pino`（Nestのlogger adapter）+ `pino-http`を使う。1要求1行で、出す項目はrequestId、method、path（クエリを除く）、statusCode、responseTime、code（Guardの結果コード）に限る。
- redactの対象は`req.headers.cookie`、`req.headers.authorization`、`res.headers["set-cookie"]`、`*.token`、`*.accessToken`、`*.idToken`、`*.refreshToken`、`*.code`、`*.sub`。redactは防御の二重化とし、主の対策は「許可した項目だけを出すserializer」とする。
- callbackのクエリ（code / state）はpathから落とす。例外のmessage / stackは既知のcodeに変換して出す。
- 認証の拒否はwarnにしない（第三者のアクセスは正常に起こりうる）。infoでcodeだけを出す。503はerrorとする。
- 監視基盤の追加はしない（詳細設計09の初期方針）。

## セキュリティ

- 公開経路は許可リスト方式（F-06）。Better Authの`disabledPaths`で二重に防御する。
- セッションはDBで検証し、Cookieキャッシュは使わない。利用許可は発行時と毎要求の2か所で確認する。発行時の判定とGuardの判定は同じ`allowlist-query`を使い、ずれを防ぐ。
- CSRF: SameSite=Lax、状態変更要求のOrigin完全一致、JSONのContent-Type必須。CORSは設定しない（別オリジンからの資格情報付き要求を許可しない）。
- 秘密値は環境変数だけに置く（`BETTER_AUTH_SECRET`、`GOOGLE_CLIENT_SECRET`、`ENROLL_GOOGLE_CLIENT_SECRET`、DB URL）。`.env.example`には名前だけを書く。`NEXT_PUBLIC_*`に秘密を置かない。
- 最小権限: app_runtimeはallowlistをSELECTだけ。DDL・TRUNCATEは不可。
- テスト用のセッション発行はテストコード内だけで行う。本番コードに環境変数で有効になる裏口を作らない。
- 実装後にsecurity-reviewerを必ず通す（L3で認証を扱うため、省略しない）。

## 性能

二人の利用で、要求ごとにDB参照が2回（セッションとallowlist）増える程度。目標値は設けない（対象外）。Poolのmax 2は維持し、M6で実測する。

## テスト方針

詳細は承認後に試験計画（docs/tests/m1-auth-onboarding.md）で作る。ここでは層と手段だけを決める。

| 層 | 手段 | 主な対象 |
|---|---|---|
| 単体 | Vitest | GetMeUseCase、Guard（SessionVerifierをfake化）、経路制限ミドルウェア、ログserializer |
| HTTP + 実DB | Supertest + Testcontainers（test:api-db） | `configure-app`で組んだ実アプリに、N-02〜03、E-03〜E-10を実行する |
| セッション発行 | `better-auth/plugins`の`testUtils`をテスト時だけauthに追加し、`login({ userId })`でDBフックを通った正規のセッションと署名Cookieを作る。本番の設定には入れない（`createAuth`の引数でテストからだけ渡し、ESLintでsrcからの`testUtils`のimportを禁止する） | 二人・第三者・停止・sub不一致・期限切れ |
| DB権限 | Testcontainersにロールを作り、app_runtimeで接続 | N-06、N-07、E-13（T-18のidentity分） |
| migration | 空DBに適用して再適用 | N-06 |
| CLI | Google部分をfakeにした単体 + 実DBのTX検証 | E-11、E-12、F-10 |
| web | Vitest + Testing Library | サインイン画面、meの表示、401で遷移、503表示 |
| 手動 | ローカルの実Google | N-01、N-04、E-01、Set-Cookieがrewriteを通ること。結果をログへ記録 |

CIにはGoogleの実通信を入れない。fixtureが通ったことを「Google OAuthの成功」と報告しない（詳細設計09 §5）。

## 移行とリリース

- 本番環境が無いため、M1のリリースはmainへのマージだけとなる。本番migrationの適用と初期登録はM7で行う。
- ローカル: `docker compose up -d --wait`（初回に`create-roles.sql`と`grant-database.sql`が流れる）→ `npm run db:migrate -w @tomotabi/api` → `enroll`で二人を登録 → `dev:api` / `dev:web`。READMEに手順を書く。
- CI: 既存のapi-dbジョブで、Testcontainers上にmigrationの適用と権限テストを追加する。本番のsecretはCIに渡さない。
- ロールバック: mainのPRをrevertすれば戻せる（本番データが無いため）。

## スパイクの結果（2026-09-24、better-auth 1.7.5・drizzle-kit 0.31.11・PostgreSQL 16）

| 確認項目 | 結果 | 設計への反映 |
|---|---|---|
| 生成スキーマ | `npx auth generate`は`pgTable`（public）で出力する。`pgSchema("identity")`に書き換えてもadapterと`getSession`は動作した。accountsにUNIQUE(provider_id, account_id)は無い。日時はタイムゾーンなし | identityスキーマへ書き換え、UNIQUEを追加し、日時は`timestamptz`にする |
| `session.create.before`が`false` | セッション行は作られず、`createSession`がnullを返す。OAuth callbackでは「unable to create session」のエラーとして扱われ、500にはならない | 設計どおり。E-01・E-02・E-05の発行拒否はこのフックで行う |
| Googleのトークン | `account.updateAccountOnSignIn: false`で、ログイン時のaccount更新が空になる | accountのDBフックは不要。設定だけで足りる |
| 暗黙のアカウント連携 | `account.accountLinking.disableImplicitLinking`は1.7.5に存在する | `enabled: false`と併用する |
| セッショントークン | DBに平文で保存される（Cookieの値の署名なし部分と同じ） | リスクR-7に追加 |
| テスト用のセッション発行 | `testUtils`プラグインの`login({ userId })`で、DBフックを通った正規のセッションと署名Cookie（`travel.session_token`、HttpOnly、Lax、Path=/）ができる。有効期間は7日 | テスト方針に反映 |
| usersの更新 | ログイン時、Google側が確認済みでDBのemail_verifiedがfalseならtrueに更新する。表示名などは既定で上書きしない | usersのUPDATEは列単位（email_verified, updated_at）に絞る。初期登録CLIはIDトークンのemail_verifiedを保存する |

## リスク

| ID | リスク | 対策 |
|---|---|---|
| R-1 | Better AuthとNestのbody parserの組み合わせで、認証bodyやcallbackが壊れる | `configure-app`を実HTTPテストで確認する。sign-in POST・callbackのクエリ・複数Set-Cookieを検証する |
| R-2 | 1.7.xのDBフックやキー名が想定と違う（`false`での中止、accountフック、disableImplicitLinking） | 実装の最初のステップで小さなスパイクテストを書いて確認する。違えば設計を更新してから進める |
| R-3 | Nextのrewriteがリダイレクトや複数Set-Cookieを変える | ローカルの実Google手動確認で検証する。問題があれば、認証経路だけAPIへ直接リダイレクトする案を検討してユーザーに報告する |
| R-4 | 生成スキーマのuuid設定とDrizzleのpgSchemaの組み合わせが通らない | 生成物を先に確認してからGRANTを書く |
| R-5 | コミュニティ製ではなく公式方式を選ぶため、Guardなどを自前で書く量が増える | Guard 2つと経路制限だけに限定する。ADR-0002に比較を残す |
| R-6 | 開発用OAuthクライアントの設定ミス（redirect URI） | READMEに登録すべきURIを正確に書く |
| R-7 | セッショントークンがDBに平文で保存される。DBの内容と署名鍵の両方が漏れると、セッションを乗っ取れる | DBの接続情報と署名鍵を別々に管理する（どちらか一方だけでは乗っ取れない）。有効期間7日・自動延長なし。利用停止CLIで全セッションを即時削除できる。Better Authの標準機能にハッシュ化が無いため、M1では行わない（ユーザー確認事項） |

## 未決事項

1. `infra.m0_probes`と /api/foundation/* を、いつ撤去するか。本設計ではM1でログイン必須にし、テスト用SQLのまま残す。M2の開始時に撤去する案を推奨する。
2. （解決済み）セッションは7日・自動延長なしで確定（2026-09-23ユーザー決定）。
3. （解決済み）Better Authの採用は2026-09-23の設計承認で確定。
4. （解決済み）実装時確認は2026-09-24のスパイクで完了。結果は「スパイクの結果」節。
6. （解決済み）セッショントークンがDBに平文で保存されるリスクR-7は、2026-09-24にユーザーが受け入れた。
5. 前提: PR #10の承認と実装が先に完了すること。
