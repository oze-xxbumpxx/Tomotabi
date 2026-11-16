# 開発の手順

手元でTomotabiを動かすための文書です。アプリが何かは`README.md`にあります。

依存の版と、試験が何件通ったかは書きません。版は`package-lock.json`、コマンドの名前はルートと各workspaceの`package.json`を見てください。この文書を書いたときに、試験の再実行はしていません。

## 採用構成

| 領域 | 内容 |
|---|---|
| 言語 | TypeScript。Nodeは24系（`package.json`の`engines`、`.nvmrc`、`.node-version`、GitHub Actionsの`node-version`。決めはADR-0008） |
| web | Next.js App Router。`app` → `screens` → `features` → `shared`。機能内は`ui` / `model` / `api`。取得のキャッシュはTanStack Query（`apps/web/src/app/providers.tsx`）。ログインのクライアントはbetter-auth（`apps/web/src/shared/auth/auth-client.ts`） |
| api | NestJSのモジュラーモノリス。業務モジュール内はController / UseCase / Service / Domain / Infrastructure / Adapter。ESM（`apps/api/package.json`の`type`、ADR-0009）。相対importには`.js`を付ける |
| 契約 | `packages/contracts`に公開APIの型とOpenAPIだけを置く。OpenAPIは`packages/contracts/openapi/`（auth、finance、foundation、notifications、planning、trips） |
| webのAPI通信 | OpenAPIからOrvalでfetch関数とZodスキーマを生成する。生成先は`apps/web/src/shared/api/generated/`と`apps/api/src/generated/`。ファイル先頭に手で編集しないと書いてある。応答はZodで検証し、neverthrowの`ResultAsync`で成功と失敗を返す（`apps/web/src/shared/api/api-result.ts`） |
| DB | Drizzle ORMと`pg`。スキーマは`identity`、`planning`、`record`、`settlement`、`notification`、`infra`（`apps/api/src/infrastructure/database/schema/`） |
| テスト | Vitest（webとapi）。APIのHTTPは`@nestjs/testing`とSupertest。実PostgreSQLはTestcontainersで、イメージは`postgres:16-alpine`（`apps/api/tests/support/database.ts`、`e2e/scripts/run.mjs`） |
| CI | GitHub Actionsのquality、build、api-db、harness（`.github/workflows/ci.yml`）とe2e（`.github/workflows/e2e.yml`）。検証用と本番へのデプロイは手動の`deploy-integration`と`deploy-production`。どちらも`deploy-vercel`を呼ぶ。出すcommitはmainの履歴に含まれるものに限る。承認はGitHubのEnvironmentの保護（`docs/runbooks/integration-env.md`） |

**Adapterの意味**: このリポジトリでは、AdapterはIFの置き場です。外部への接続の実装はInfrastructureに置きます。例は`apps/api/src/modules/notification/adapter/outbound/push-sender.ts`（interface）と、同じモジュールの`infrastructure/web-push-sender.ts`です。共通のUnitOfWorkのIFは`apps/api/src/adapter/transaction/`にあります。

## ディレクトリ

```text
apps/web/src/
  app/                 ルートと layout
  screens/             画面の組立（ホーム、旅行、しおり、ToDo、記録、支払い、精算、通知の設定、ログイン）
  features/            auth、foundation、notifications、payments、plans、records、settlement、todos、trips
  shared/              汎用UI、HTTP、認証クライアント、生成したAPIクライアント
apps/api/src/
  modules/             identity、planning、record、settlement、notification、foundation
  adapter/             共通のIF（transaction、clock、after-response）
  composition/         モジュールをまたぐ組み立て
  infrastructure/      pool、DBのスキーマ、ログ
  cli/                 初期登録、利用停止、VAPIDの鍵
  generated/           Orvalが生成したZod
apps/api/drizzle/      migrationのSQL
apps/api/db/admin/     ロールを作るSQL（superuserで実行）
packages/contracts/    公開APIの型とOpenAPI
e2e/                   Playwrightの仕様と起動スクリプト
docs/                  設計、試験の記録、この文書
.claude/               スキル、フック、エージェント、試験（進め方はAGENTS.md）
```

## 前提

- Node 24系。`engines`は`>=24.0.0 <25`です。
- Dockerが動いていること。`npm run test:api-db`、`npm run test:e2e`、`npm run manual:push`は、TestcontainersでPostgreSQLを起動します。単体テストとbuildには不要です。
- E2Eを初めて動かす前に`npx playwright install chromium`。CIの`e2e.yml`は`npx playwright install --with-deps chromium`を実行します。

## 環境変数

名前と意味は`.env.example`にあります。本番の値は、そのファイルに書きません。

| 名前 | 役割 |
|---|---|
| `DATABASE_URL` | APIの実行時接続（`app_runtime`）。未設定または空だと、下の「DBが無いとき」になる |
| `MIGRATION_DATABASE_URL` | migrationと管理CLI（`migrator`）。実行用の`DATABASE_URL`をここへ入れない |
| `API_ORIGIN` | Next.jsが`/api`を転送する先。未設定時の既定は`http://localhost:3001`（`apps/web/next.config.ts`）。末尾スラッシュなし |
| `PUBLIC_APP_ORIGIN` | 公開アプリのオリジン。better-authのbaseURLと、Originの一致に使う。末尾スラッシュなし |
| `BETTER_AUTH_SECRET` | セッションの署名 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ログイン用のGoogle OAuth（ウェブクライアント） |
| `ENROLL_GOOGLE_CLIENT_ID` / `ENROLL_GOOGLE_CLIENT_SECRET` | 初期登録CLI専用のデスクトップ型クライアント |
| `VAPID_KEYS` | Web Pushの鍵のJSON配列。`current`は1つ。無い、または形が崩れていると、通知の機能だけが止まる |
| `VAPID_SUBJECT` | VAPIDの連絡先。`mailto:`か`https:`で始まる |
| `PORT` | APIの待受。`.env.example`の例は3001 |

`DATABASE_URL`があるのに`PUBLIC_APP_ORIGIN`、`BETTER_AUTH_SECRET`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`のどれかが無いと、APIは起動時に失敗します（`apps/api/src/modules/identity/infrastructure/better-auth.ts`の`createAuthFromEnv`）。

## コマンド

ルートの`package.json`です。

```bash
npm install
npm run dev:api          # apps/api の nest start --watch。待受は PORT（例は 3001）
npm run dev:web          # http://localhost:3000。/api は API_ORIGIN へ転送する
npm run lint
npm run type-check
npm test                 # workspace の単体と HTTP。Testcontainers は含まない
npm run test:web
npm run test:api
npm run test:coverage    # 各アプリの coverage/ に text、html、json-summary
npm run test:api-db      # 実 PostgreSQL。Docker が必要
npm run build            # contracts、api、web の順
npm run build:web
npm run build:api
npm run test:harness     # node --test .claude/tests/*.test.mjs
npm run test:e2e         # 下の「E2E」
npm run manual:push      # 下の「通知の手動確認」
npm run api:generate     # Orval で API クライアントを再生成
npm run api:check        # 再生成し、generated の2か所に差分が無いことを見る。CI でも実行する
npm run db:check         # migration の整合と、drizzle の生成漏れ。CI でも実行する
```

`api:check`が見るパスは、`apps/web/src/shared/api/generated`と`apps/api/src/generated`です。

workspaceのスクリプトは、次のとおりです。

```bash
npm run db:generate -w @tomotabi/api
npm run db:migrate -w @tomotabi/api
npm run cli:enroll -w @tomotabi/api -- --slot 0
npm run cli:disable -w @tomotabi/api -- --slot 0
npm run cli:generate-vapid-key -w @tomotabi/api -- <出力ファイル>
```

## DBが無いとき

`DATABASE_URL`が未設定または空のとき、動くものは次のとおりです。

- foundationの検証カウンタはin-memoryです（`apps/api/src/modules/foundation/foundation.module.ts`）。
- better-authは作りません。セッション確認は`unavailable`を返し、Guardは503（`AUTH_UNAVAILABLE`）にします（`better-auth-session-verifier.ts`、`session.guard.ts`）。
- 認証の公開経路も、authが無いときは503です（`apps/api/src/bootstrap/auth-route-allowlist.ts`）。
- 旅行などの組み立ては、Guardが先に503か401を返すため実装は呼ばれない、と`planning-composition.module.ts`に書いてあります。

`apps/api/src`にPGliteへの置き換えはありません。この起動は、実PostgreSQLの試験の代わりにはなりません。

## ローカルDBとmigration

DBのスキーマの正は`apps/api/src/infrastructure/database/schema/`のDrizzle定義です。SQLの履歴は`apps/api/drizzle/`にあります（ADR-0003）。アプリの起動時にmigrationは適用しません。

| ロール | 用途 | 権限 |
|---|---|---|
| `migrator` | migrationの適用（管理者だけ） | スキーマと表の所有、DDL |
| `app_runtime` | APIの実行時接続（`DATABASE_URL`） | 表ごとに必要なDMLだけ。`statement_timeout`は5秒（`apps/api/db/admin/create-roles.sql`） |

```bash
docker compose up -d --wait
MIGRATION_DATABASE_URL=postgres://migrator:migrator@127.0.0.1:5432/tomotabi \
  npm run db:migrate -w @tomotabi/api
```

`compose.yaml`の待受は`127.0.0.1:5432`です。ローカルのパスワード（`migrator` / `app_runtime`）はcomposeの既定値で、ローカル専用です。本番のロールとパスワードは別の手順で作ります（`docs/runbooks/`）。

管理用SQLは`apps/api/db/admin/`の2つです。どちらもsuperuserで、`psql -v ON_ERROR_STOP=1`を付けて実行します。

1. `create-roles.sql`: ロールの作成。ロールはクラスタ全体で共有されるため、クラスタごとに1回です。2回目は失敗します。パスワードの変更は`ALTER ROLE`で行います。
2. `grant-database.sql`: DBごとの接続と作成の権限。DBごとに実行し、何度実行しても同じ結果です。

スキーマを変えたら`npm run db:generate -w @tomotabi/api`でmigrationを作り、生成されたSQLをレビューしてコミットします。GRANTなどは`npx drizzle-kit generate --custom`の空ファイルに書きます。表を追加したら、既存のGRANTのmigrationと同じ形で権限を足し、`apps/api/tests/db/`の権限テストと同じ形で試験を足します。

`infra.m0_probes`は本番のmigrationに入っていません。定義は`apps/api/src/infrastructure/database/sql/m0_probe.sql`です。`npm run db:migrate`だけではこの表は作れないので、ローカルDBに`DATABASE_URL`を向けても、検証カウンタはこの表を使えません。実DBの試験は、このSQLを別途当てています。

## 管理CLI

管理者端末でだけ実行します。アプリのHTTPルートには載せません。接続は`MIGRATION_DATABASE_URL`（migrator）です。

**初期登録（`cli:enroll`）**

Google Cloudでデスクトップ型のOAuthクライアントを別に作り、`ENROLL_GOOGLE_CLIENT_ID`と`ENROLL_GOOGLE_CLIENT_SECRET`に入れます。リダイレクトURIの登録は不要です。クライアントは、待受中のポートを使います。コールバックの既定の待ち時間は5分です（`apps/api/src/cli/enroll/loopback-server.ts`）。

```bash
MIGRATION_DATABASE_URL=postgres://migrator:migrator@127.0.0.1:5432/tomotabi \
ENROLL_GOOGLE_CLIENT_ID=... ENROLL_GOOGLE_CLIENT_SECRET=... \
  npm run cli:enroll -w @tomotabi/api -- --slot 0
```

スロットは0か1です。表示されたURLをブラウザで開き、表示名、メール、subの末尾4文字を確認して`yes`と入力すると、`identity.users`、`identity.accounts`、`identity.allowed_google_accounts`を1トランザクションで登録します。`yes`以外では何も登録しません。slot、sub、emailの重複は一意制約で失敗し、全部ロールバックします。

**利用停止（`cli:disable`）**

```bash
MIGRATION_DATABASE_URL=postgres://migrator:migrator@127.0.0.1:5432/tomotabi \
  npm run cli:disable -w @tomotabi/api -- --slot 0
```

allowlistの`enabled`をfalseにし、そのユーザーのセッションを削除します。再実行しても同じ結果で成功します。スロットに登録が無いときは、何も変えずに失敗します。

**VAPIDの鍵（`cli:generate-vapid-key`）**

```bash
npm run cli:generate-vapid-key -w @tomotabi/api -- <出力ファイル> [--key-id <ID>]
```

`VAPID_KEYS`に足す1要素のJSONを、権限0600のファイルへ書きます。秘密鍵は標準出力に出しません（`apps/api/src/cli/generate-vapid-key.ts`）。

## 検証用のHTTP

グローバルの接頭辞は`api`です（`apps/api/src/bootstrap/configure-app.ts`）。

| 方法 | 経路 | 意味 |
|---|---|---|
| GET | `/api/health` | プロセスが生きていること。DBには触らない |
| GET | `/api/health/migrations` | migrationの状態。デプロイの手順が読む |
| GET | `/api/foundation/probes` | 検証カウンタ |
| POST | `/api/foundation/probes/increment` | 検証カウンタを1加算 |

公開している認証の経路は、Googleでのログイン、コールバック、ログアウトの3つです（`apps/api/src/bootstrap/auth-route-allowlist.ts`）。それ以外の`/api/auth/*`は404です。

## E2Eと通知の手動確認

`npm run test:e2e`は`e2e/scripts/run.mjs`を起動します。TestcontainersでPostgreSQLを作り、ロールとmigrationを当て、二人（ひなた、あおい）を入れ、Playwrightを絞り込みなしで実行します。追加の引数はPlaywrightへ渡ります。待受はwebが3100、apiが3101です（`e2e/support/env.ts`）。開発用の3000と3001とは別です。

`npm run manual:push`は、同じようにDBを用意したあと、APIとwebを3000と3001で起動し、本物のChromeを2つ開きます。`npm run dev:api`と`npm run dev:web`は止めてから実行します。Ctrl-Cで、Chrome、API、web、DBを止めます。

## ハーネス

`.claude/`に、スキル（`skills/`）、フック（`hooks/`）、検証役（`agents/reviewer.md`と`agents/security-reviewer.md`）、ルール（`rules/`）、スクリプト（`scripts/`）、試験（`tests/`）があります。

試験は`npm run test:harness`です。導入の記録と、Claude Codeの外で状態を扱うときの環境変数は`docs/harness-setup.md`にあります。日々の作業分担は`AGENTS.md`です。
