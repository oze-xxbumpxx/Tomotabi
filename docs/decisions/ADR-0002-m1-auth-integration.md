# ADR-0002: Better AuthのNestJSへの組み込みと二人の初期登録方式

- Status: Accepted（2026-09-23ユーザー承認）
- Date: 2026-09-23
- 関連feature: m1-auth-onboarding

## Context（背景・なぜ判断が必要か）

詳細設計03は、Better Auth（Google、Drizzle adapter、DBセッション）をNestJS上に置くと決めている。ただし次の2点は具体化されていない。

1. NestJSへの組み込み方。Better Authはraw bodyを読むため、Nestの既定のbody parserと衝突する。公開経路を4つに絞る必要もある。
2. 二人の初期登録方法。「管理者端末でGoogle本人確認をし、検証済みsubを1トランザクションで登録。本番ルートに含めない」という条件だけがある。

どちらもM2以降の全APIの認可と、本番運用手順の前提になる。

## Decision（採用した決定）

### 1. 公式のExpressハンドラー方式で組み込む

- `NestFactory.create(..., { bodyParser: false })`で起動する。Expressインスタンスに次の順でマウントする。
  1. 公開4経路の許可リストミドルウェア（それ以外は404。POSTはOrigin完全一致が必須）
  2. `toNodeHandler(auth)`
  3. その後にNest用のJSON body parser
- 業務APIの保護は、自前の`SessionGuard` / `OriginGuard`を`APP_GUARD`で全体に適用する。`auth.api.getSession`の結果にallowlistの判定を加え、userIdをUseCaseへ渡す。
- 上の組み込みは`bootstrap/configure-app.ts`にまとめ、本番とテストで共有する。

### 2. 初期登録はローカル専用CLIとする

- 管理者端末で`127.0.0.1`の一時サーバーを立てる。初期登録専用のGoogle OAuthクライアント（デスクトップ型）で、state / PKCE / nonce付きの認可コードフローを行う。
- `google-auth-library`でIDトークンを検証し、管理者の確認後にusers / accounts / allowlistを1トランザクションで登録する。
- 利用停止もCLI（enabled=false + 全セッション削除）で行う。

## Alternatives（検討した非採用案と却下理由）

| 案 | 却下理由 |
|---|---|
| `@thallesp/nestjs-better-auth`（Better Auth公式ドキュメントが案内するコミュニティ製モジュール） | 導入は速い。しかしコミュニティ保守で、全経路のマウントを前提にしている。公開4経路への制限、Originの必須化、allowlistの毎回判定は結局自前で足す必要がある。依存が1つ増える割に、制御点がライブラリの内側に隠れる。詳細設計03も公式のNode / Express統合を基にすると書いている |
| Better AuthのハンドラーをNest Controllerの中で呼ぶ | body parserを経路単位で外す必要がある。Nestの例外フィルターがSet-Cookieやリダイレクトを変えるおそれもある |
| 初期登録でsubを手入力するCLI | 実装は最小。しかし未検証の値から登録することになり、詳細設計03 §3の「ブラウザ申告や未検証の値から登録しない」に反する |
| 一時的にサインアップを有効にしたデプロイで登録する | 本番ルートに一時的でも登録経路が出る。閉じ忘れのリスクがある |
| 初期登録をM7まで先送りし、M1はseedだけにする | M1でローカルの実ログインを確認できない（ユーザー決定により不採用） |

## Consequences（良い影響・悪い影響・残るリスク）

- 良い: 公開経路・Origin・認可の制御点がすべてリポジトリ内のコードにあり、テストで確かめられる。保護が既定のため、Guardの付け忘れが安全側に倒れる。登録処理は本番のHTTP面に存在しない。
- 悪い: Guardと経路制限を自前で保守する。Better Authの版を上げるとき、非公開経路の一覧（`disabledPaths`）を見直す必要がある。
- 悪い: 初期登録にはOAuthクライアントがもう1つ要る。登録の頻度は低いが、手順書を保守する必要がある。
- 残るリスク: Nextのrewrite経由のSet-Cookieとリダイレクトは、実環境で確認するまで未検証（設計書R-3）。

## Migration（移行が必要な場合の手順）

対象外（既存の認証も利用者データも無い）。

## Rollback（決定を戻す場合の手順）

- 組み込み方式: `configure-app.ts`の差し替えだけで、コミュニティ製モジュールへ移行できる。Guardは置き換えるか、併用する。UseCaseはuserIdを引数で受けるだけなので影響しない。
- 初期登録: CLIを捨ててもDBのデータ形式は変わらない。登録済みの行はそのまま使える。

## References（設計書・要件・関連ADR・外部資料へのリンク）

- docs/designs/m1-auth-onboarding.md、docs/requirements/m1-auth-onboarding.md
- `docs/旅行アプリ設計 3/詳細設計/03_認証とセッション.md` §1〜§3、§8
- https://www.better-auth.com/docs/integrations/express （ハンドラーをbody parserより前にマウントする。Express 5は`/api/auth/*splat`）
- https://www.better-auth.com/docs/integrations/nestjs （コミュニティ製モジュール、`bodyParser: false`）
- https://www.better-auth.com/docs/reference/options （disabledPaths、generateId、session、disableSignUp）
- https://developers.google.com/identity/protocols/oauth2/native-app （ループバックIPによるデスクトップアプリのフロー）
