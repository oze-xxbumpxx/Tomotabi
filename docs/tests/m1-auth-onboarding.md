# 試験計画: m1-auth-onboarding

- 前提となる設計書: docs/designs/m1-auth-onboarding.md
- レベル: L3
- 要件との対応: 各観点の「要件」列に docs/requirements/m1-auth-onboarding.md の ID を書く。全 ID の対応は末尾の表で確認する

## 試験種別

| 種別 | 手段 | CI | 対象 |
|---|---|---|---|
| 単体 | Vitest（DB なし） | `npm test` | UserId、Guard、経路制限、ログ、UseCase、CLI（Google 部分は fake）、web |
| HTTP | Supertest ＋ `configure-app` で組んだ実アプリ | `npm test`（DB 不要な範囲） | 経路制限・Origin・Content-Type・503 |
| 実 DB | Testcontainers `postgres:16-alpine`、ロール作成＋ migrate | `npm run test:api-db` | migration、権限、セッション発行と Guard、CLI のトランザクション |
| 手動 | ローカルの実 Google（開発用 OAuth クライアント） | 対象外 | 実ログイン、初期登録、rewrite 経由の Cookie |
| E2E | 対象外（Playwright 未導入） | — | — |

セッションは、テストプロセスの中で `better-auth/test`（無ければ Better Auth の内部 adapter）を使い、正規の署名 Cookie と DB セッションとして作る。fixture が通ったことを「Google OAuth の成功」とは報告しない（詳細設計 09 §5）。

## 単体試験観点

| # | 観点 | 前提 | 操作 | 期待結果 | 分類 | 要件 |
|---|---|---|---|---|---|---|
| U-01 | UserId: 正しい UUID | なし | `UserId.parse(uuid)` | 同じ値の UserId | 正常 | 設計 |
| U-02 | UserId: 形式違い・空文字 | なし | `parse("abc")` / `parse("")` | 例外 | 異常 | 設計 |
| U-03 | SessionGuard: 認証済み | Verifier が authenticated | 要求 | 通過し、request に UserId | 正常 | F-04 |
| U-04 | SessionGuard: 未認証 | unauthenticated | 要求 | 401 `UNAUTHENTICATED` | 異常 | E-03 |
| U-05 | SessionGuard: 許可停止 | forbidden | 要求 | 403 `FORBIDDEN_NOT_ALLOWED` | 異常 | E-04 |
| U-06 | SessionGuard: DB 不可 | unavailable | 要求 | 503 `AUTH_UNAVAILABLE`。Set-Cookie を出さない | 異常 | E-10 |
| U-07 | SessionGuard: 公開経路 | `@PublicRoute` | 要求 | Verifier を呼ばずに通過 | 正常 | B-04 |
| U-08 | OriginGuard: GET / HEAD | Origin なし | 要求 | 通過 | 境界 | B-05 |
| U-09 | OriginGuard: Origin 欠落・`null`・別 Origin・末尾スラッシュ違い | POST | 要求 | 403 `FORBIDDEN_ORIGIN` | 異常 | E-06 |
| U-10 | OriginGuard: Content-Type 違い | POST、Origin 一致、`text/plain` | 要求 | 415 `UNSUPPORTED_MEDIA_TYPE` | 異常 | E-07 |
| U-11 | 経路制限: 公開 4 経路 | なし | 4 経路をそれぞれ正しいメソッドで | 次へ渡す | 正常 | F-06 |
| U-12 | 経路制限: 非公開経路 | なし | get-session、list-sessions、list-accounts、link-social、delete-user、update-user など | 404 | 異常 | E-08 |
| U-13 | 経路制限: メソッド違い | なし | `GET /api/auth/sign-out` など | 404 | 異常 | E-08 |
| U-14 | 経路制限: POST の Origin | sign-in / sign-out | 別 Origin | 403 | 異常 | E-06 |
| U-15 | sign-in の body 検査 | before フック | provider が google 以外 / idToken あり / callbackURL が `/` 以外 | 400 | 異常 | E-09 |
| U-16 | GetMeUseCase | IdentityReader の fake | 実行 | id・displayName・sessionExpiresAt だけを返す | 正常 | F-07 |
| U-17 | ログ serializer | cookie・authorization・set-cookie・code・sub を含む要求 | 1 行出力 | 許可項目だけ。path からクエリを除く | 異常 | 非機能 |
| U-18 | ログ: 例外 | message に DB URL を含む例外 | 出力 | 既知の code だけ。URL を含まない | 異常 | 非機能 |

## 結合試験観点（実 DB）

### migration と権限（M1-a）

| # | 観点 | 前提 | 操作 | 期待結果 | 分類 | 要件 |
|---|---|---|---|---|---|---|
| D-01 | 空 DB への適用 | ロール作成済み | migrate | identity の 5 表ができる | 正常 | N-06 |
| D-02 | 再適用 | D-01 の後 | もう一度 migrate | 履歴とスキーマが変わらない | 冪等 | N-06 |
| D-03 | 制約 | D-01 | `information_schema` / `pg_constraint` | UNIQUE(provider_id, account_id)、allowlist の PK・CHECK・UNIQUE・FK | 正常 | B-01 |
| D-04 | allowlist 3 人目 | 2 行登録済み | slot 2 を INSERT | CHECK 違反 | 境界 | B-01 |
| D-05 | allowlist の重複 | 1 行登録済み | 同じ sub / 同じ user_id | UNIQUE 違反 | 異常 | B-01 |
| D-06 | google_sub の長さ | なし | 0 文字 / 256 文字 | CHECK 違反 | 境界 | B-01 |
| D-07 | app_runtime の必要 DML | app_runtime で接続 | sessions・verifications の INSERT / UPDATE / DELETE、accounts の UPDATE、全表の SELECT | 成功 | 正常 | N-07 |
| D-08 | app_runtime の allowlist | app_runtime | allowlist の INSERT / UPDATE / DELETE | 権限エラー | 異常 | E-13 |
| D-09 | app_runtime の DDL | app_runtime | CREATE TABLE / DROP / TRUNCATE / ALTER | 権限エラー | 異常 | E-13 |
| D-10 | app_runtime の users | app_runtime | users の INSERT / DELETE、name・email の UPDATE | 権限エラー。email_verified・updated_at の UPDATE だけは成功 | 異常 | E-13 |
| D-11 | statement_timeout | app_runtime | `SHOW statement_timeout` | 5s | 正常 | 設計 |
| D-12 | 過剰な権限がない | D-01 | `has_table_privilege` を全表×全権限で列挙 | GRANT 表と完全一致 | 整合 | F-12 |

### 認証と Guard（M1-b）

| # | 観点 | 前提 | 操作 | 期待結果 | 分類 | 要件 |
|---|---|---|---|---|---|---|
| H-01 | sign-in の body が壊れない | 実アプリ | 正しい POST sign-in/social | 200 とリダイレクト URL | 正常 | R-1 |
| H-02 | callback のクエリ | 実アプリ | `GET /api/auth/callback/google?state=…&code=…`（不正な state） | Better Auth のエラーとして処理される。500 にならない | 異常 | R-1 |
| H-03 | 複数 Set-Cookie | fixture のセッション | sign-out | Set-Cookie がすべて返る | 正常 | R-1 |
| A-01 | 二人とも利用できる | slot 0 / 1 を登録、各セッション | `GET /api/me` | 200、それぞれ自分の id・表示名 | 正常 | N-02 |
| A-02 | 第三者にはセッションを発行しない | 未登録の user / account | セッション作成 | 失敗し、sessions に行が残らない | 異常 | E-01 |
| A-03 | 許可停止中の発行拒否 | enabled=false | セッション作成 | 失敗、行が残らない | 異常 | E-02 |
| A-04 | sub 不一致の発行拒否 | accounts.account_id ≠ allowlist.google_sub | セッション作成 | 失敗 | 異常 | E-05 |
| A-05 | 発行後の許可停止 | 有効なセッション → enabled=false | `/api/me` | 403 | 異常 | E-04、N-05 |
| A-06 | 発行後の sub 不一致 | 有効なセッション → allowlist の sub を変更 | `/api/me` | 403 | 異常 | E-05 |
| A-07 | Cookie なし・偽造・署名違い | なし | `/api/me` | 401 | 異常 | E-03 |
| A-08 | 期限切れ | expires_at を過去に | `/api/me` | 401 | 境界 | E-03、B-02 |
| A-09 | 期限ちょうど | expires_at = 現在 | `/api/me` | 401 | 境界 | B-02 |
| A-10 | 7 日・自動延長なし | 発行直後 | expires_at を確認し、要求を繰り返す | 発行＋7 日のまま変わらない | 正常 | F-03 |
| A-11 | ログアウト | 有効なセッション、Origin 一致 | sign-out → `/api/me` | セッション行が消え、以後 401 | 正常 | N-03 |
| A-12 | ログアウト済みの sign-out | セッションなし | sign-out | 200 と Cookie 消去 | 境界 | B-03 |
| A-13 | 別 Origin の sign-out | 有効なセッション | 別 Origin で sign-out | 403、セッションは残る | 異常 | E-06 |
| A-14 | foundation はログイン必須 | なし / セッションあり | `GET /api/foundation/probes` | 401 / 200 | 正常 | B-04 |
| A-15 | health は公開 | なし | `GET /api/health` | 200 | 正常 | B-04 |
| A-16 | 応答に秘密がない | A-01 | `/api/me` の body を検査 | sub・メール・token を含まない | 異常 | F-07 |
| A-17 | トークンが DB に残らない | セッション発行と account 更新 | accounts を SELECT | access / refresh / id token が null | 異常 | 非機能 |
| A-18 | DB 停止 | 起動後にコンテナを停止 | `/api/me` | 503、Set-Cookie なし | 異常 | E-10 |
| A-19 | プロフィールが変わっても同一人物 | 同じ sub で name / email を変更 | セッション発行 → `/api/me` | 同じ user.id | 正常 | N-08 |

### 管理 CLI（M1-c）

| # | 観点 | 前提 | 操作 | 期待結果 | 分類 | 要件 |
|---|---|---|---|---|---|---|
| C-01 | 登録できる | 空の identity、Google の fake が検証済みの sub を返す | enroll --slot 0 → yes | users・accounts・allowlist が 1 トランザクションで入る。account の token 列は null | 正常 | N-04 |
| C-02 | 二人目 | C-01 の後 | enroll --slot 1 | 2 行目が入る | 正常 | N-04 |
| C-03 | 使用中の slot | C-01 の後 | enroll --slot 0（別 sub） | ロールバック、既存行は不変 | 異常 | E-11 |
| C-04 | 登録済みの sub | C-01 の後 | enroll --slot 1（同じ sub） | ロールバック | 異常 | E-11 |
| C-05 | state 不一致 | fake が別の state で callback | 実行 | 何も登録しない | 異常 | E-12 |
| C-06 | ID トークン検証失敗 | fake の verify が失敗（aud / iss / exp / nonce） | 実行 | 何も登録しない | 異常 | E-12 |
| C-07 | 確認で拒否 | 確認に `no` | 実行 | 何も登録しない。token を出力しない | 異常 | E-12 |
| C-08 | 利用停止 | 二人登録、各セッション 2 件 | disable --slot 1 | enabled=false、その人のセッションだけ全削除 | 正常 | F-10、N-05 |
| C-09 | 利用停止の再実行 | C-08 の後 | もう一度 | 同じ状態のまま成功 | 冪等 | F-10 |

### web（M1-d）

| # | 観点 | 前提 | 操作 | 期待結果 | 分類 | 要件 |
|---|---|---|---|---|---|---|
| W-01 | サインイン画面 | なし | 描画 | 「Google でログイン」だけ。メール欄・登録導線・同意文なし | 正常 | F-14 |
| W-02 | ログイン開始 | クライアントの fake | ボタン押下 | `signIn.social({ provider: "google", callbackURL: "/" })` | 正常 | F-01 |
| W-03 | ログインのエラー表示 | `/sign-in?error=…` | 描画 | 原因を問わない一般的な文。ボタン直上 | 異常 | E-01 |
| W-04 | ホーム: 表示名 | `/api/me` が 200 | 描画 | 表示名とログアウト | 正常 | N-02 |
| W-05 | ホーム: 401 | `/api/me` が 401 | 描画 | `/sign-in` へ replace。自動再送なし | 異常 | F-14 |
| W-06 | ホーム: 503 | `/api/me` が 503 | 描画 | 「一時的に利用できません」と再試行。`/sign-in` へ飛ばさない | 異常 | E-10 |
| W-07 | ホーム: 応答の検証失敗 | `/api/me` の body が契約違反 | 描画 | エラー表示。未検証の値を表示しない | 異常 | 設計 |
| W-08 | ログアウト | ログイン中 | ボタン押下 | 画面状態を消して `/sign-in` へ | 正常 | N-03 |

## 手動確認（実 Google。M1-d の最後）

| # | 観点 | 手順 | 期待結果 | 要件 |
|---|---|---|---|---|
| M-01 | 初期登録 | enroll を slot 0 / 1 で実行し、二人がそれぞれ Google で確認 | 2 行登録。ターミナル・ファイルに token が出ない | N-04 |
| M-02 | 二人のログイン | それぞれのアカウントで `/sign-in` からログイン | ホームに自分の表示名 | N-01 |
| M-03 | 第三者 | 未登録の Google アカウントでログイン | ログインできず、一般的なエラー表示 | E-01 |
| M-04 | rewrite 経由の Cookie | 開発者ツールで Set-Cookie と Cookie 属性を確認 | HttpOnly・SameSite=Lax・Path=/・Domain なし。ローカルは Secure なし | 非機能、R-3 |
| M-05 | ログアウト | ログアウト → ブラウザの戻る | ログイン画面。ホームは 401 | N-03 |
| M-06 | 利用停止 | disable を実行 → 対象者が画面を更新 | 403 の表示 | N-05 |
| M-07 | ログの確認 | M-01〜M-06 の間の API ログを確認 | Cookie・code・sub・token が出ていない | 非機能 |

結果は作業ログに「実施日・実施者・結果」で記録する。未実施の項目は未実施と書き、成功扱いにしない。

## 特性観点

- 権限: 二人・第三者・許可停止・sub 不一致・期限切れ（A-01〜A-09）、app_runtime の最小権限（D-07〜D-12）
- データ整合性: 発行拒否で sessions に行が残らない（A-02〜A-04）。CLI の 1 トランザクション（C-01〜C-04、C-08）
- 冪等性: migration の再適用（D-02）、ログアウト済みの sign-out（A-12）、利用停止の再実行（C-09）
- 障害系: DB 停止で 503、Cookie を消さない（U-06、A-18、W-06）。自動リトライはしない（設計どおりのため観点なし）
- フロントエンド: 読み込み・401・503・検証失敗（W-04〜W-07）
- 防御性（UserId）: 形式違いの拒否（U-02）。ブランド型のため可変状態は持たない

## メソッド網羅チェック表

実装後に public メソッドを列挙して埋める。計画時点での対応は次のとおり。

| クラス / 関数 | メソッド | 対応する観点 |
|---|---|---|
| UserId | parse | U-01、U-02 |
| SessionGuard | canActivate | U-03〜U-07、A-01〜A-09 |
| OriginGuard | canActivate | U-08〜U-10、A-13 |
| authRouteAllowlist | （ミドルウェア） | U-11〜U-14、E-08 |
| configureApp | （関数） | H-01〜H-03 |
| BetterAuthSessionVerifier | verify | A-01〜A-09、A-18 |
| allowlistQuery | isAllowed | A-02〜A-06 |
| GetMeUseCase | execute | U-16、A-16 |
| PgIdentityReader | findDisplayName | A-01、A-19 |
| enrollGoogleAccount | （CLI） | C-01〜C-07 |
| disableGoogleAccount | （CLI） | C-08、C-09 |
| logger serializers | req / res / err | U-17、U-18 |

## 回帰試験範囲

- foundation の既存 HTTP テスト 27 件: ログイン済みの fixture を使う形に直したうえで、同じ観点が通ること（A-14）
- foundation の DB テスト（m0_probe）: 変更なしで通ること
- web の既存テスト（probe の取得・加算・検証失敗）: ログイン後のホームに置いても通ること
- `npm run api:check`（Orval の再生成差分なし）

## 試験データ

- 利用者: slot 0「ひなた」、slot 1「あおい」、第三者「そうた」。sub・メールは架空の値（例: `test-sub-0`、`hinata@example.test`）
- Origin: `http://localhost:3000`（ローカル）、別 Origin は `http://evil.example.test`
- 実 Google の確認は、本人と相手の実アカウントを使う。sub・メールはログや資料に書かない

## 完了条件

- U・D・H・A・C・W の全観点が自動テストで成功する
- 要件の N-01〜08、E-01〜13、B-01〜05 がすべて下表でいずれかの観点に対応している
- M-01〜M-07 の結果がログに記録されている（未実施の項目は未実施と明記）
- lint / type-check / test / test:api-db / build / api:check がすべて成功する

### 要件との対応表

| 要件 | 観点 |
|---|---|
| N-01 | M-02 |
| N-02 | A-01、W-04 |
| N-03 | A-11、W-08、M-05 |
| N-04 | C-01、C-02、M-01 |
| N-05 | A-05、C-08、M-06 |
| N-06 | D-01、D-02 |
| N-07 | D-07 |
| N-08 | A-19 |
| E-01 | A-02、W-03、M-03 |
| E-02 | A-03 |
| E-03 | U-04、A-07、A-08 |
| E-04 | U-05、A-05 |
| E-05 | A-04、A-06 |
| E-06 | U-09、U-14、A-13 |
| E-07 | U-10 |
| E-08 | U-12、U-13 |
| E-09 | U-15 |
| E-10 | U-06、A-18、W-06 |
| E-11 | C-03、C-04 |
| E-12 | C-05〜C-07 |
| E-13 | D-08〜D-10 |
| B-01 | D-03〜D-06 |
| B-02 | A-08、A-09 |
| B-03 | A-12 |
| B-04 | U-07、A-14、A-15 |
| B-05 | U-08 |
