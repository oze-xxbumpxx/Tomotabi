---
name: testing-web-ui
description: Tomotabiのapps/web（Next.js）をapps/api（NestJS）と一緒にローカルで起動してUIテストする手順。認証の503/401両モードの再現方法とheadless Chromeの注意点を含む。Docker無しでPostgresを立てる方法、実ログイン相当のセッションCookieの作り方、iOSシミュレータでの検証の注意を含む。
---

# Tomotabi web UIのローカルテスト

## 起動
- `npm run dev:api` → NestJS http://localhost:3001。`PUBLIC_APP_ORIGIN=http://localhost:3000` を付けて起動すること（未設定だと`POST /api/auth/*`がOriginチェックで503ではなく403になる）。
- `npm run dev:web` → Next.js http://localhost:3000。`/api/*` は3001にrewriteされる（next.config.ts）。

## 認証状態の切り替え
- DATABASE_URL未設定: `/api/me`も`/api/auth/*`も503 `{"code":"AUTH_UNAVAILABLE"}`。
- 401を再現したいとき: `docker compose up -d db`（compose.yamlのローカルPostgres。initスクリプトでmigrator/app_runtimeロールが作られる）→ `DATABASE_URL=postgres://app_runtime:app_runtime@127.0.0.1:5432/tomotabi PUBLIC_APP_ORIGIN=http://localhost:3000 BETTER_AUTH_SECRET=<32文字以上の任意> GOOGLE_CLIENT_ID=<任意> GOOGLE_CLIENT_SECRET=<任意> npm run dev:api`で再起動。セッションCookie無しの`/api/me`は401になる（getSessionはCookie無しだとDBを叩かずnullを返すのでmigration不要）。
- Googleへの遷移試行まで見るには`apps/api/drizzle/*.sql`を`docker exec -i tomotabi-db-1 psql "postgres://migrator:migrator@localhost:5432/tomotabi" -v ON_ERROR_STOP=1 < ファイル`で適用する（`drizzle-kit migrate`は非TTYで無言でexit 1になることがある）。ダミーのGOOGLE_CLIENT_IDではaccounts.google.comがinvalid_clientエラーを出すが、遷移試行の証拠として十分。

## headless Chromeの注意
- CJKフォントが無く日本語は豆腐表示になる。文言の確認は`read_dom` / `browser_console`のDOMテキストで補う。
- `prefers-color-scheme`のエミュレートはCDPの`Emulation.setEmulatedMedia`で可能（ポートは`pgrep -af chrome | grep remote-debugging-port`）。**WebSocketを閉じるとエミュレートが解除される**ので、スクリーンショット中は接続を保持する。Node 22の組み込みWebSocket + `http://127.0.0.1:<port>/json`でtargetを取得して送ればよい。
- アドレスバーで`localhost:3000/`と打つと履歴の`/sign-in`がオートコンプリートで選ばれて誤遷移することがある。`/?t=1`のようにクエリを付けて回避する。

## Dockerが無い環境でPostgresを立てる
- `brew install postgresql@16 && brew services start postgresql@16`で足りる。compose.yamlのinitスクリプトと同等のことは手作業でできる：
  - `createuser -h 127.0.0.1 -U postgres migrator` / `app_runtime`を作る（パスワードは`apps/api/db/admin/`のSQLを参照。実ファイル: `create-roles.sql`, `grant-database.sql`）
  - `createdb -h 127.0.0.1 -U postgres -O migrator tomotabi`
  - migrationは`psql "postgres://migrator:migrator@127.0.0.1:5432/tomotabi" -v ON_ERROR_STOP=1 -f apps/api/drizzle/<file>.sql`で全ファイル順に適用
  - シードユーザーを作るには`e2e/seed.mts`のINSERTをpsqlで流す（testcontainers不要）

## 実ログイン相当のセッションCookieを作る
- `apps/api/src/modules/identity/infrastructure/better-auth.ts`の`createAuth`が`testUtils`プラグインを内蔵している。`e2e/support/auth.ts`と同じく`auth.testUtils.helpers.login({ userId })`で`travel.session_token`を発行できる。`useSecureCookies`はNODE_ENV=productionのときだけなのでローカルでは`Secure`無しでOK。
- Cookieをブラウザへ入れる最も確実な方法は、apps/webに一時的なrouteを作って`Set-Cookie`を返させること（httpOnlyなのでJSからは書けない）。同オリジン経由なのでSafari・モバイル実機でも効く。使い終わったらrouteは消してコミットに入れない。
- iOSシミュレータのSafariはURLバー経由だと長いtoken文字列が切り詰められる。tokenはURLパラメータではなくファイル（例`/tmp/token.txt`）経由でrouteに渡す。

## iOSシミュレータで検証する
- `xcrun simctl boot <UDID>`で起動。`computer`ツールのiOS targetの`inspect`/`query`/`act`でSafari内のWeb要素を触れる。
- 日本語入力は`type`アクションでは入らないことがある。textinputのrefに`set_text`を使う。**先に`focus`してから**`set_text`すること（focusなしだと反映されず空のまま保存される）。
- 画面下端からのスワイプはアプリ内操作ではなくSafariのタブ一覧を開いてしまう。下端のドラッグは避ける。
- レイアウトシフト直後のタップは外れやすい。1操作ごとにスクリーンショットで確認してから次を押す。

## Devin Secrets Needed
- なし（実Google OAuthログインを検証する場合のみGOOGLE_CLIENT_ID/SECRETと許可リスト登録が必要）
