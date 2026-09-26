---
name: testing-web-ui
description: Tomotabi の apps/web（Next.js）を apps/api（NestJS）と一緒にローカルで起動して UI テストする手順。認証の 503/401 両モードの再現方法と headless Chrome の注意点を含む。
---

# Tomotabi web UI のローカルテスト

## 起動
- `npm run dev:api` → NestJS http://localhost:3001。`PUBLIC_APP_ORIGIN=http://localhost:3000` を付けて起動すること（未設定だと `POST /api/auth/*` が Origin チェックで 503 ではなく 403 になる）。
- `npm run dev:web` → Next.js http://localhost:3000。`/api/*` は 3001 に rewrite される（next.config.ts）。

## 認証状態の切り替え
- DATABASE_URL 未設定: `/api/me` も `/api/auth/*` も 503 `{"code":"AUTH_UNAVAILABLE"}`。
- 401 を再現したいとき: `docker compose up -d db`（compose.yaml のローカル Postgres。init スクリプトで migrator/app_runtime ロールが作られる）→ `DATABASE_URL=postgres://app_runtime:app_runtime@127.0.0.1:5432/tomotabi PUBLIC_APP_ORIGIN=http://localhost:3000 BETTER_AUTH_SECRET=<32文字以上の任意> GOOGLE_CLIENT_ID=<任意> GOOGLE_CLIENT_SECRET=<任意> npm run dev:api` で再起動。セッション Cookie 無しの `/api/me` は 401 になる（getSession は Cookie 無しだと DB を叩かず null を返すので migration 不要）。
- Google への遷移試行まで見るには `apps/api/drizzle/*.sql` を `docker exec -i tomotabi-db-1 psql "postgres://migrator:migrator@localhost:5432/tomotabi" -v ON_ERROR_STOP=1 < ファイル` で適用する（`drizzle-kit migrate` は非 TTY で無言で exit 1 になることがある）。ダミーの GOOGLE_CLIENT_ID では accounts.google.com が invalid_client エラーを出すが、遷移試行の証拠として十分。

## headless Chrome の注意
- CJK フォントが無く日本語は豆腐表示になる。文言の確認は `read_dom` / `browser_console` の DOM テキストで補う。
- `prefers-color-scheme` のエミュレートは CDP の `Emulation.setEmulatedMedia` で可能（ポートは `pgrep -af chrome | grep remote-debugging-port`）。**WebSocket を閉じるとエミュレートが解除される**ので、スクリーンショット中は接続を保持する。Node 22 の組み込み WebSocket + `http://127.0.0.1:<port>/json` で target を取得して送ればよい。
- アドレスバーで `localhost:3000/` と打つと履歴の `/sign-in` がオートコンプリートで選ばれて誤遷移することがある。`/?t=1` のようにクエリを付けて回避する。

## Devin Secrets Needed
- なし（実 Google OAuth ログインを検証する場合のみ GOOGLE_CLIENT_ID/SECRET と許可リスト登録が必要）
