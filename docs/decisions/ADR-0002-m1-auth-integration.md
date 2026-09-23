# ADR-0002: Better Auth の NestJS への組み込みと二人の初期登録方式

- Status: Proposed
- Date: 2026-09-23
- 関連 feature: m1-auth-onboarding

## Context（背景・なぜ判断が必要か）

詳細設計 03 は、Better Auth（Google、Drizzle adapter、DB セッション）を NestJS 上に置くと決めている。ただし次の 2 点は具体化されていない。

1. NestJS への組み込み方。Better Auth は raw body を読むため、Nest の既定の body parser と衝突する。公開経路を 4 つに絞る必要もある。
2. 二人の初期登録方法。「管理者端末で Google 本人確認をし、検証済み sub を 1 トランザクションで登録。本番ルートに含めない」という条件だけがある。

どちらも M2 以降の全 API の認可と、本番運用手順の前提になる。

## Decision（採用した決定）

### 1. 公式の Express ハンドラー方式で組み込む

- `NestFactory.create(..., { bodyParser: false })` で起動する。Express インスタンスに次の順でマウントする。
  1. 公開 4 経路の許可リストミドルウェア（それ以外は 404。POST は Origin 完全一致が必須）
  2. `toNodeHandler(auth)`
  3. その後に Nest 用の JSON body parser
- 業務 API の保護は、自前の `SessionGuard` / `OriginGuard` を `APP_GUARD` で全体に適用する。`auth.api.getSession` の結果に allowlist の判定を加え、userId を UseCase へ渡す。
- 上の組み込みは `bootstrap/configure-app.ts` にまとめ、本番とテストで共有する。

### 2. 初期登録はローカル専用 CLI とする

- 管理者端末で `127.0.0.1` の一時サーバーを立てる。初期登録専用の Google OAuth クライアント（デスクトップ型）で、state / PKCE / nonce 付きの認可コードフローを行う。
- `google-auth-library` で ID トークンを検証し、管理者の確認後に users / accounts / allowlist を 1 トランザクションで登録する。
- 利用停止も CLI（enabled=false + 全セッション削除）で行う。

## Alternatives（検討した非採用案と却下理由）

| 案 | 却下理由 |
|---|---|
| `@thallesp/nestjs-better-auth`（Better Auth 公式ドキュメントが案内するコミュニティ製モジュール） | 導入は速い。しかしコミュニティ保守で、全経路のマウントを前提にしている。公開 4 経路への制限、Origin の必須化、allowlist の毎回判定は結局自前で足す必要がある。依存が 1 つ増える割に、制御点がライブラリの内側に隠れる。詳細設計 03 も公式の Node / Express 統合を基にすると書いている |
| Better Auth のハンドラーを Nest Controller の中で呼ぶ | body parser を経路単位で外す必要がある。Nest の例外フィルターが Set-Cookie やリダイレクトを変えるおそれもある |
| 初期登録で sub を手入力する CLI | 実装は最小。しかし未検証の値から登録することになり、詳細設計 03 §3 の「ブラウザ申告や未検証の値から登録しない」に反する |
| 一時的にサインアップを有効にしたデプロイで登録する | 本番ルートに一時的でも登録経路が出る。閉じ忘れのリスクがある |
| 初期登録を M7 まで先送りし、M1 は seed だけにする | M1 でローカルの実ログインを確認できない（ユーザー決定により不採用） |

## Consequences（良い影響・悪い影響・残るリスク）

- 良い: 公開経路・Origin・認可の制御点がすべてリポジトリ内のコードにあり、テストで確かめられる。保護が既定のため、Guard の付け忘れが安全側に倒れる。登録処理は本番の HTTP 面に存在しない。
- 悪い: Guard と経路制限を自前で保守する。Better Auth の版を上げるとき、非公開経路の一覧（`disabledPaths`）を見直す必要がある。
- 悪い: 初期登録には OAuth クライアントがもう 1 つ要る。登録の頻度は低いが、手順書を保守する必要がある。
- 残るリスク: Next の rewrite 経由の Set-Cookie とリダイレクトは、実環境で確認するまで未検証（設計書 R-3）。

## Migration（移行が必要な場合の手順）

対象外（既存の認証も利用者データも無い）。

## Rollback（決定を戻す場合の手順）

- 組み込み方式: `configure-app.ts` の差し替えだけで、コミュニティ製モジュールへ移行できる。Guard は置き換えるか、併用する。UseCase は userId を引数で受けるだけなので影響しない。
- 初期登録: CLI を捨てても DB のデータ形式は変わらない。登録済みの行はそのまま使える。

## References（設計書・要件・関連 ADR・外部資料へのリンク）

- docs/designs/m1-auth-onboarding.md、docs/requirements/m1-auth-onboarding.md
- `docs/旅行アプリ設計 3/詳細設計/03_認証とセッション.md` §1〜§3、§8
- https://www.better-auth.com/docs/integrations/express （ハンドラーを body parser より前にマウントする。Express 5 は `/api/auth/*splat`）
- https://www.better-auth.com/docs/integrations/nestjs （コミュニティ製モジュール、`bodyParser: false`）
- https://www.better-auth.com/docs/reference/options （disabledPaths、generateId、session、disableSignUp）
- https://developers.google.com/identity/protocols/oauth2/native-app （ループバック IP によるデスクトップアプリのフロー）
