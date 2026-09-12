-- 検証専用：空のDBで01_finance.sqlを検証するための他領域の最小依存表。
-- 本番のユーザー・旅行・予定の完全な設計ではない。本番マイグレーションへそのまま使わない。
CREATE SCHEMA identity;
CREATE SCHEMA planning;
CREATE TABLE identity.users (id uuid PRIMARY KEY);
CREATE TABLE planning.trips (id uuid PRIMARY KEY);
CREATE TABLE planning.plans (
    id uuid PRIMARY KEY,
    trip_id uuid NOT NULL REFERENCES planning.trips(id),
    UNIQUE (trip_id, id)
);
CREATE TABLE planning.trip_participants (
    trip_id uuid NOT NULL REFERENCES planning.trips(id),
    slot smallint NOT NULL CHECK (slot IN (0, 1)),
    user_id uuid NOT NULL REFERENCES identity.users(id),
    PRIMARY KEY (trip_id, slot),
    UNIQUE (trip_id, user_id)
);
