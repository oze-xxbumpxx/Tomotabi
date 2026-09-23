-- 設計検証用DDL。identity.usersはBetter Auth生成スキーマとの統合確認が必要。
CREATE SCHEMA notification;
CREATE TABLE notification.push_subscriptions (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES identity.users(id),
 endpoint text NOT NULL CHECK (length(endpoint) BETWEEN 1 AND 4096),
 endpoint_hash bytea NOT NULL UNIQUE CHECK (octet_length(endpoint_hash)=32),
 p256dh bytea NOT NULL CHECK (octet_length(p256dh)=65 AND get_byte(p256dh,0)=4),
 auth_secret bytea NOT NULL CHECK (octet_length(auth_secret)=16),
 expiration_time timestamptz,
 registration_session_id text NOT NULL CHECK (length(registration_session_id)>0),
 device_label text NOT NULL CHECK (length(device_label) BETWEEN 1 AND 60),
 vapid_key_id text NOT NULL CHECK (length(vapid_key_id) BETWEEN 1 AND 64),
 enabled boolean NOT NULL DEFAULT true,
 revision bigint NOT NULL DEFAULT 1 CHECK (revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (updated_at>=created_at)
);
CREATE INDEX push_subscriptions_user ON notification.push_subscriptions(user_id);
CREATE INDEX push_subscriptions_session ON notification.push_subscriptions(user_id,registration_session_id) WHERE enabled;
-- 通知再送キューではない。ログアウト後の遅延登録を防ぐセッション単位の停止記録。
CREATE TABLE notification.closed_push_sessions (
 session_id text PRIMARY KEY CHECK (length(session_id)>0),
 user_id uuid NOT NULL REFERENCES identity.users(id),
 closed_at timestamptz NOT NULL DEFAULT now()
);
-- UseCaseの責務：所有者・許可・P256曲線・ハッシュ一致・期限・ホストを確認。
-- PUT/DELETE/ログアウト前処理は同じidentity.users行のFOR UPDATEで直列化。
-- 有効上限3は期限切れを無効化してから件数判定。上限をCHECK制約で保証とは扱わない。
-- 404/410処理：WHERE id=$id AND revision=$sentRevision AND enabledで条件付き無効化。
-- 無効化を含む変更はrevision+1,updated_at更新。無変更は更新しない。
