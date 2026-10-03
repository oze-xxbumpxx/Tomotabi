# 要件定義: m1-auth-onboarding

- task-id / 変更レベル: M1 / L3（認証・認可、DBスキーマ、本番migration、DB権限）
- 作成日: 2026-09-23
- ステータス: confirmed（2026-09-23ユーザー承認）
- 正本: `docs/旅行アプリ設計 3/詳細設計/03_認証とセッション.md`、`02_ORMとDB_API.md`、`08_デプロイと無料枠運用.md` §6、`09_テストと監視_CI.md` §5・§8、`10_Cursor実装順序.md`のM1行、`sql/02_auth_allowlist.sql`、`openapi.auth.json`

## 背景

M0（PR #9）でNext.js / NestJS / Drizzle + pg / Vitest / Testcontainersの基盤ができた。ただし認証が無く、DBは検証用の`infra.m0_probes`しか無い。M2以降の旅行・支払い・精算は、すべて「二人のうち誰の操作か」を前提にしている。そのため、M1で本人確認・二人限定の認可・DBの土台を先に固める。

## 目的

- 登録済みの二人だけがGoogleでログインでき、第三者・失効セッション・別OriginをAPIが拒否する。この状態を、実APIと実PostgreSQLで確認できるようにする。
- 本番migrationの仕組みと、実行ロールの最小権限をM1で確立する。後続のM2〜M5はそこへ表を足すだけにする。

## ユーザー要求（原文の要約）

「M1（認証・二人の初期登録・Cookie / Guard・本番migration）のプランを作成したい」。2026-09-23の確認で次を決定した。

- 初期登録: ローカル専用CLI（管理者端末でGoogle本人確認 → 検証済みsubを1トランザクションで登録）
- 実Google: ローカル環境で実ログインまで手動確認する。CIはfixtureで検証する
- web: 最小画面（/sign-in、ログイン後の表示、ログアウト、401時の遷移）
- 順序: PR #10（Zod・neverthrow・Orval）を先に実装し、M1のweb通信はその方式で書く

## 機能要件

| ID | 要件 |
|---|---|
| F-01 | Googleのリダイレクト方式ログインだけを提供する。メール / パスワード認証、他provider、idToken直接入力、追加scope、任意callbackURLは受け付けない |
| F-02 | 事前登録済み、かつ利用許可（allowlistのenabled）が有効なGoogleアカウントだけにセッションを発行する。新規サインアップ・暗黙のアカウント紐付け・メール一致による紐付けは行わない |
| F-03 | セッションはDBで管理し、Cookieで運ぶ。有効期間は発行から7日、自動延長なし、Cookieキャッシュなし（2026-09-23ユーザー決定。旅行期間を考えて7日で足りると判断。リフレッシュトークンは持たない） |
| F-04 | 業務APIはGuardで「セッション検証 → 利用許可」を毎回確認し、検証済みのuserIdだけをUseCaseへ渡す。リクエストbodyやヘッダーのuserIdを操作主体にしない |
| F-05 | 状態を変える要求（POST / PUT / PATCH / DELETE）は、Originが公開オリジンと完全一致することを必須とする。bodyを持つ操作とPOSTはContent-Type: application/jsonを必須とする |
| F-06 | 公開する認証経路は次の3つに限る: POST /api/auth/sign-in/social、GET /api/auth/callback/google、POST /api/auth/sign-out。get-sessionなどライブラリの他の経路は公開しない（404）。ログイン失敗時の戻り先はwebの /sign-in?error=… とし、ライブラリのGET /api/auth/errorは使わない |
| F-07 | GET /api/meで表示用の最小情報（user.id、displayName、sessionExpiresAt）を返す。Google sub・メール・トークンは返さない |
| F-08 | ログアウトは現在のセッションをサーバーで削除し、Cookieを失効させる（通知停止の前処理はM5） |
| F-09 | 初期登録CLI: 管理者端末でGoogle本人確認（state / PKCE / nonce、IDトークンの署名・iss・aud・exp検証）を行い、確認後にusers / accounts / allowlistを1トランザクションで登録する。本番のHTTPルートには含めない |
| F-10 | 利用停止CLI: 指定slotのenabledをfalseにし、その利用者の全セッションを同じトランザクションで削除する |
| F-11 | Drizzle Kitによる版管理されたmigrationを導入する。Better Auth標準表・allowlist・DBロールへのGRANTを含み、空DBから適用できる。アプリ起動時には自動適用しない |
| F-12 | DBロールをmigrator（DDL・所有）とapp_runtime（必要なDMLだけ）に分ける |
| F-13 | PinoによるJSONログを導入する。許可した項目だけを出力し、秘密値をredactする |
| F-14 | web: /sign-inにGoogleログインボタンを置く。ログイン後はGET /api/meの表示名を表示し、ログアウトボタンを置く。APIが401を返したら /sign-inへ遷移する |

## 非機能要件（性能・セキュリティ・可用性など）

- セキュリティ: Cookieは本番で`__Secure-`接頭辞・Secure・HttpOnly・SameSite=Lax・Path=/・Domain未設定。baseURLとtrustedOriginsは固定値とし、Host / X-Forwarded-Hostから生成しない。
- 秘密情報: Googleのcode / token / sub、Cookie、DB URL、Better Auth secretをログ・レスポンス・ブラウザbundle・CI artifactに出さない。Googleのaccess / refresh / id tokenはDBに残さない。
- 可用性: 認証DBに接続できないときは503とし、未認証（401）として扱わない。Cookieも消さない。
- 性能: 目標値は対象外（二人利用。M6で無料枠消費を測定）。
- 互換: Node 22.x。依存の版は実装開始時にlockfileで固定する（調査時点の最新はbetter-auth 1.7.5、drizzle-kit 0.31.11）。

## 正常系

| ID | 内容 |
|---|---|
| N-01 | 登録済み・許可中の利用者がGoogleログインすると、Cookieが設定されて固定のログイン後ページへ戻る |
| N-02 | 有効なCookieでGET /api/meを呼ぶと、200で自分のid・表示名・セッション期限が返る |
| N-03 | Originが一致するPOST /api/auth/sign-outでセッションがDBから消える。同じCookieでの以後の要求は401になる |
| N-04 | 初期登録CLIでslot 0 / 1に二人を登録できる。登録後、その二人はN-01のとおりログインできる |
| N-05 | 利用停止CLIで停止した利用者は、既存セッションも含めて以後の業務APIが拒否される |
| N-06 | 空のPostgreSQLにmigrationを適用すると全表・制約・GRANTができる。2回目の適用は何もしない |
| N-07 | app_runtimeロールで、ログイン・セッション検証・ログアウトに必要なDMLが成功する |
| N-08 | Googleプロフィールの表示名やメールが変わっても、subが同じなら同一利用者としてログインできる |

## 異常系

| ID | 内容 | 期待 |
|---|---|---|
| E-01 | 未登録のGoogleアカウント（第三者）でログイン | セッションを発行しない。一般的なエラー表示 |
| E-02 | 登録済みだがallowlistが無効な利用者がログイン | セッションを発行しない |
| E-03 | Cookieなし・偽造Cookie・期限切れ・削除済みセッションで業務API | 401 |
| E-04 | 有効なセッションだがallowlistが無効化された | 403 |
| E-05 | accountsのsubとallowlistのgoogle_subが一致しない | 403（セッション発行時は拒否） |
| E-06 | 状態変更要求でOriginが欠落・`null`・別Origin | 403 |
| E-07 | POSTでContent-Typeがapplication/jsonでない | 415 |
| E-08 | 公開4経路以外の /api/auth/*（get-session、list-accounts等） | 404 |
| E-09 | sign-in/socialにgoogle以外のprovider、idToken、許可外のcallbackURL | 400 |
| E-10 | 認証DBに接続できない | 503。Cookieは消さない |
| E-11 | 初期登録CLIで、既に使用中のslot・登録済みのsub・3人目を登録しようとする | ロールバックして中止。既存行は変わらない |
| E-12 | 初期登録CLIでstate不一致・IDトークン検証失敗・利用者が確認を拒否 | 何も登録せず中止 |
| E-13 | app_runtimeでallowlistへのUPDATE / INSERT、DDL、TRUNCATE | 権限エラー |

## 境界条件（null・空・上限/下限・権限境界）

| ID | 内容 |
|---|---|
| B-01 | allowlistは最大2行（slot 0 / 1のCHECKとPK）。google_subは1〜255文字で一意、user_idも一意 |
| B-02 | セッション期限ちょうど（expiresAt以降）は無効 |
| B-03 | ログアウト済みでsessionを識別できないsign-outは、200でCookieを消去する |
| B-04 | foundationの検証経路（/api/foundation/*）はM1でログイン必須にする。/api/healthは公開のまま |
| B-05 | GET / HEADはOrigin検査の対象外。副作用を持たせない |

## 前提

- PR #10（Zod・neverthrow・Orval）の実装がmainに入っていること。
- ローカルの実Google確認のため、ユーザーがGoogle Cloudで開発用OAuthクライアントを2つ作る（ログイン用のWebアプリ型、初期登録CLI用のデスクトップ型）。テストユーザーは二人に限定する。
- ローカル開発DBはDocker上のPostgreSQL 16（M0のTestcontainersと同じmajor）。

## 制約

- 公開用のテストログイン裏口を作らない。テスト用のセッション発行はテストプロセスの中だけに置く。
- Next.jsに認証DB接続やBetter Authのサーバー実体を置かない。Next.jsはボタン・表示・遷移だけを担う。
- `sql/00`〜`05`をそのまま本番migrationとして実行しない。allowlistは`sql/02`を参照仕様としてDrizzleスキーマに落とす。
- 本番（Neon / Vercel）の作成・操作、有料サービスの利用は行わない。

## 対象範囲

- `apps/api`: identityモジュール（Better Auth設定、認証ハンドラーのマウントと経路制限、SessionGuard / OriginGuard、GET /api/me）、Pino、DBスキーマとmigration、ロールとGRANT、初期登録・利用停止CLI
- `apps/web`: sign-in画面、ログイン後表示、ログアウト、401時の遷移（features/auth）
- `packages/contracts`: 認証APIのOpenAPIとwire型
- ローカル開発用PostgreSQLのcompose定義、`.env.example`、README

## 対象外

- 旅行・予定・支払い・精算・通知の業務機能（M2以降）
- ログアウト時の通知停止処理（M5）
- Vercel / Neonの作成、本番OAuthクライアント、本番へのmigration適用、本番の初期登録（M6〜M7）
- Service Workerとオフラインのログアウト処理（後続）
- Playwright E2E（ブラウザでの実Googleログインは手動確認）

## 後方互換性・データ移行

- 既存データは無い。本番DBも未作成で、データ移行は発生しない。
- 既存API: /api/healthは公開のまま変更しない。/api/foundation/* は認証必須になる（B-04）。M0の検証UIは、ログイン後だけ動作する。
- `infra.m0_probes`はmigrationに含めない。M0のテスト用SQLのまま残す（扱いは設計書の未決事項）。

## 受け入れ条件（Definition of Doneに対応）

1. N-01〜08、E-01〜13、B-01〜05を試験計画の観点に採番して反映し、自動テストで確認する。E-01 / N-01 / N-04の実Google部分はローカルでの手動確認とし、結果を記録する。
2. 二人・第三者・失効・Origin拒否を、実NestJS + 実PostgreSQL（Testcontainers）のHTTPテストで確認する。
3. 空DBへのmigration適用、app_runtimeの権限（許可される操作と拒否される操作）をTestcontainersで確認する。
4. ログ出力にCookie・Google code / token / sub・DB URLが含まれないことをテストで確認する。
5. lint / type-check / test / test:api-db / buildがすべて成功する。
6. 公開のテストログイン経路が存在しないことをレビューで確認する。

## 未決事項（誰に何を確認するか）

- （解決済み）Better Authの採用は、2026-09-23の本M1の設計承認をもって確定とする。
- ユーザー: Google Cloudの開発用OAuthクライアント作成（あなたの操作が必要）。
- 実装時確認: Better Auth 1.7.xの生成スキーマ、accountに保存されるトークン列を空にできるか、セッショントークンの保存形式、DBフックの戻り値によるセッション発行拒否の挙動。
