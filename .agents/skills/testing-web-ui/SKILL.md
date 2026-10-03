---
name: testing-web-ui
description: Tomotabiのapps/web（Next.js）をapps/api（NestJS）と一緒にローカルで起動してUIテストする手順。認証の503/401両モードの再現方法とheadless Chromeの注意点を含む。
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

## Devin Secrets Needed
- なし（実Google OAuthログインを検証する場合のみGOOGLE_CLIENT_ID/SECRETと許可リスト登録が必要）
