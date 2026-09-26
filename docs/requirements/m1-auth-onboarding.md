# 要件定義: m1-auth-onboarding

- task-id / 変更レベル: M1 / L3（認証・認可、DB スキーマ、本番 migration、DB 権限）
- 作成日: 2026-09-23
- ステータス: confirmed（2026-09-23 ユーザー承認）
- 正本: `docs/旅行アプリ設計 3/詳細設計/03_認証とセッション.md`、`02_ORMとDB_API.md`、`08_デプロイと無料枠運用.md` §6、`09_テストと監視_CI.md` §5・§8、`10_Cursor実装順序.md` の M1 行、`sql/02_auth_allowlist.sql`、`openapi.auth.json`

## 背景

M0（PR #9）で Next.js / NestJS / Drizzle + pg / Vitest / Testcontainers の基盤ができた。ただし認証が無く、DB は検証用の `infra.m0_probes` しか無い。M2 以降の旅行・支払い・精算は、すべて「二人のうち誰の操作か」を前提にしている。そのため、M1 で本人確認・二人限定の認可・DB の土台を先に固める。

## 目的

- 登録済みの二人だけが Google でログインでき、第三者・失効セッション・別 Origin を API が拒否する。この状態を、実 API と実 PostgreSQL で確認できるようにする。
- 本番 migration の仕組みと、実行ロールの最小権限を M1 で確立する。後続の M2〜M5 はそこへ表を足すだけにする。

## ユーザー要求（原文の要約）

「M1（認証・二人の初期登録・Cookie / Guard・本番 migration）のプランを作成したい」。2026-09-23 の確認で次を決定した。

- 初期登録: ローカル専用 CLI（管理者端末で Google 本人確認 → 検証済み sub を 1 トランザクションで登録）
- 実 Google: ローカル環境で実ログインまで手動確認する。CI は fixture で検証する
- web: 最小画面（/sign-in、ログイン後の表示、ログアウト、401 時の遷移）
- 順序: PR #10（Zod・neverthrow・Orval）を先に実装し、M1 の web 通信はその方式で書く

## 機能要件

| ID | 要件 |
|---|---|
| F-01 | Google のリダイレクト方式ログインだけを提供する。メール / パスワード認証、他 provider、idToken 直接入力、追加 scope、任意 callbackURL は受け付けない |
| F-02 | 事前登録済み、かつ利用許可（allowlist の enabled）が有効な Google アカウントだけにセッションを発行する。新規サインアップ・暗黙のアカウント紐付け・メール一致による紐付けは行わない |
| F-03 | セッションは DB で管理し、Cookie で運ぶ。有効期間は発行から 7 日、自動延長なし、Cookie キャッシュなし（2026-09-23 ユーザー決定。旅行期間を考えて 7 日で足りると判断。リフレッシュトークンは持たない） |
| F-04 | 業務 API は Guard で「セッション検証 → 利用許可」を毎回確認し、検証済みの userId だけを UseCase へ渡す。リクエスト body やヘッダーの userId を操作主体にしない |
| F-05 | 状態を変える要求（POST / PUT / PATCH / DELETE）は、Origin が公開オリジンと完全一致することを必須とする。body を持つ操作と POST は Content-Type: application/json を必須とする |
| F-06 | 公開する認証経路は次の 3 つに限る: POST /api/auth/sign-in/social、GET /api/auth/callback/google、POST /api/auth/sign-out。get-session などライブラリの他の経路は公開しない（404）。ログイン失敗時の戻り先は web の /sign-in?error=… とし、ライブラリの GET /api/auth/error は使わない |
| F-07 | GET /api/me で表示用の最小情報（user.id、displayName、sessionExpiresAt）を返す。Google sub・メール・トークンは返さない |
| F-08 | ログアウトは現在のセッションをサーバーで削除し、Cookie を失効させる（通知停止の前処理は M5） |
| F-09 | 初期登録 CLI: 管理者端末で Google 本人確認（state / PKCE / nonce、ID トークンの署名・iss・aud・exp 検証）を行い、確認後に users / accounts / allowlist を 1 トランザクションで登録する。本番の HTTP ルートには含めない |
| F-10 | 利用停止 CLI: 指定 slot の enabled を false にし、その利用者の全セッションを同じトランザクションで削除する |
| F-11 | Drizzle Kit による版管理された migration を導入する。Better Auth 標準表・allowlist・DB ロールへの GRANT を含み、空 DB から適用できる。アプリ起動時には自動適用しない |
| F-12 | DB ロールを migrator（DDL・所有）と app_runtime（必要な DML だけ）に分ける |
| F-13 | Pino による JSON ログを導入する。許可した項目だけを出力し、秘密値を redact する |
| F-14 | web: /sign-in に Google ログインボタンを置く。ログイン後は GET /api/me の表示名を表示し、ログアウトボタンを置く。API が 401 を返したら /sign-in へ遷移する |

## 非機能要件（性能・セキュリティ・可用性など）

- セキュリティ: Cookie は本番で `__Secure-` 接頭辞・Secure・HttpOnly・SameSite=Lax・Path=/・Domain 未設定。baseURL と trustedOrigins は固定値とし、Host / X-Forwarded-Host から生成しない。
- 秘密情報: Google の code / token / sub、Cookie、DB URL、Better Auth secret をログ・レスポンス・ブラウザ bundle・CI artifact に出さない。Google の access / refresh / id token は DB に残さない。
- 可用性: 認証 DB に接続できないときは 503 とし、未認証（401）として扱わない。Cookie も消さない。
- 性能: 目標値は対象外（二人利用。M6 で無料枠消費を測定）。
- 互換: Node 22.x。依存の版は実装開始時に lockfile で固定する（調査時点の最新は better-auth 1.7.5、drizzle-kit 0.31.11）。

## 正常系

| ID | 内容 |
|---|---|
| N-01 | 登録済み・許可中の利用者が Google ログインすると、Cookie が設定されて固定のログイン後ページへ戻る |
| N-02 | 有効な Cookie で GET /api/me を呼ぶと、200 で自分の id・表示名・セッション期限が返る |
| N-03 | Origin が一致する POST /api/auth/sign-out でセッションが DB から消える。同じ Cookie での以後の要求は 401 になる |
| N-04 | 初期登録 CLI で slot 0 / 1 に二人を登録できる。登録後、その二人は N-01 のとおりログインできる |
| N-05 | 利用停止 CLI で停止した利用者は、既存セッションも含めて以後の業務 API が拒否される |
| N-06 | 空の PostgreSQL に migration を適用すると全表・制約・GRANT ができる。2 回目の適用は何もしない |
| N-07 | app_runtime ロールで、ログイン・セッション検証・ログアウトに必要な DML が成功する |
| N-08 | Google プロフィールの表示名やメールが変わっても、sub が同じなら同一利用者としてログインできる |

## 異常系

| ID | 内容 | 期待 |
|---|---|---|
| E-01 | 未登録の Google アカウント（第三者）でログイン | セッションを発行しない。一般的なエラー表示 |
| E-02 | 登録済みだが allowlist が無効な利用者がログイン | セッションを発行しない |
| E-03 | Cookie なし・偽造 Cookie・期限切れ・削除済みセッションで業務 API | 401 |
| E-04 | 有効なセッションだが allowlist が無効化された | 403 |
| E-05 | accounts の sub と allowlist の google_sub が一致しない | 403（セッション発行時は拒否） |
| E-06 | 状態変更要求で Origin が欠落・`null`・別 Origin | 403 |
| E-07 | POST で Content-Type が application/json でない | 415 |
| E-08 | 公開 4 経路以外の /api/auth/*（get-session、list-accounts 等） | 404 |
| E-09 | sign-in/social に google 以外の provider、idToken、許可外の callbackURL | 400 |
| E-10 | 認証 DB に接続できない | 503。Cookie は消さない |
| E-11 | 初期登録 CLI で、既に使用中の slot・登録済みの sub・3 人目を登録しようとする | ロールバックして中止。既存行は変わらない |
| E-12 | 初期登録 CLI で state 不一致・ID トークン検証失敗・利用者が確認を拒否 | 何も登録せず中止 |
| E-13 | app_runtime で allowlist への UPDATE / INSERT、DDL、TRUNCATE | 権限エラー |

## 境界条件（null・空・上限/下限・権限境界）

| ID | 内容 |
|---|---|
| B-01 | allowlist は最大 2 行（slot 0 / 1 の CHECK と PK）。google_sub は 1〜255 文字で一意、user_id も一意 |
| B-02 | セッション期限ちょうど（expiresAt 以降）は無効 |
| B-03 | ログアウト済みで sessionを識別できない sign-out は、200 で Cookie を消去する |
| B-04 | foundation の検証経路（/api/foundation/*）は M1 でログイン必須にする。/api/health は公開のまま |
| B-05 | GET / HEAD は Origin 検査の対象外。副作用を持たせない |

## 前提

- PR #10（Zod・neverthrow・Orval）の実装が main に入っていること。
- ローカルの実 Google 確認のため、ユーザーが Google Cloud で開発用 OAuth クライアントを 2 つ作る（ログイン用の Web アプリ型、初期登録 CLI 用のデスクトップ型）。テストユーザーは二人に限定する。
- ローカル開発 DB は Docker 上の PostgreSQL 16（M0 の Testcontainers と同じ major）。

## 制約

- 公開用のテストログイン裏口を作らない。テスト用のセッション発行はテストプロセスの中だけに置く。
- Next.js に認証 DB 接続や Better Auth のサーバー実体を置かない。Next.js はボタン・表示・遷移だけを担う。
- `sql/00`〜`05` をそのまま本番 migration として実行しない。allowlist は `sql/02` を参照仕様として Drizzle スキーマに落とす。
- 本番（Neon / Vercel）の作成・操作、有料サービスの利用は行わない。

## 対象範囲

- `apps/api`: identity モジュール（Better Auth 設定、認証ハンドラーのマウントと経路制限、SessionGuard / OriginGuard、GET /api/me）、Pino、DB スキーマと migration、ロールと GRANT、初期登録・利用停止 CLI
- `apps/web`: sign-in 画面、ログイン後表示、ログアウト、401 時の遷移（features/auth）
- `packages/contracts`: 認証 API の OpenAPI と wire 型
- ローカル開発用 PostgreSQL の compose 定義、`.env.example`、README

## 対象外

- 旅行・予定・支払い・精算・通知の業務機能（M2 以降）
- ログアウト時の通知停止処理（M5）
- Vercel / Neon の作成、本番 OAuth クライアント、本番への migration 適用、本番の初期登録（M6〜M7）
- Service Worker とオフラインのログアウト処理（後続）
- Playwright E2E（ブラウザでの実 Google ログインは手動確認）

## 後方互換性・データ移行

- 既存データは無い。本番 DB も未作成で、データ移行は発生しない。
- 既存 API: /api/health は公開のまま変更しない。/api/foundation/* は認証必須になる（B-04）。M0 の検証 UI は、ログイン後だけ動作する。
- `infra.m0_probes` は migration に含めない。M0 のテスト用 SQL のまま残す（扱いは設計書の未決事項）。

## 受け入れ条件（Definition of Done に対応）

1. N-01〜08、E-01〜13、B-01〜05 を試験計画の観点に採番して反映し、自動テストで確認する。E-01 / N-01 / N-04 の実 Google 部分はローカルでの手動確認とし、結果を記録する。
2. 二人・第三者・失効・Origin 拒否を、実 NestJS + 実 PostgreSQL（Testcontainers）の HTTP テストで確認する。
3. 空 DB への migration 適用、app_runtime の権限（許可される操作と拒否される操作）を Testcontainers で確認する。
4. ログ出力に Cookie・Google code / token / sub・DB URL が含まれないことをテストで確認する。
5. lint / type-check / test / test:api-db / build がすべて成功する。
6. 公開のテストログイン経路が存在しないことをレビューで確認する。

## 未決事項（誰に何を確認するか）

- （解決済み）Better Auth の採用は、2026-09-23 の本 M1 の設計承認をもって確定とする。
- ユーザー: Google Cloud の開発用 OAuth クライアント作成（あなたの操作が必要）。
- 実装時確認: Better Auth 1.7.x の生成スキーマ、account に保存されるトークン列を空にできるか、セッショントークンの保存形式、DB フックの戻り値によるセッション発行拒否の挙動。
