-- 認証ライブラリの標準テーブルは採用バージョンの生成結果から別途定義する。
-- このDDLは追加の二人限定の許可表のみ。identity.users(id uuid)を前提とする。
BEGIN;
CREATE TABLE identity.allowed_google_accounts (
    slot smallint PRIMARY KEY CHECK (slot IN (0,1)),
    user_id uuid NOT NULL UNIQUE REFERENCES identity.users(id),
    google_sub text NOT NULL UNIQUE CHECK (char_length(google_sub) BETWEEN 1 AND 255),
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);
-- 初期登録は管理者の検証済みOAuth結果からのみ。
-- 通常アプリDBロールには本表のSELECTだけを許可する。
COMMIT;
