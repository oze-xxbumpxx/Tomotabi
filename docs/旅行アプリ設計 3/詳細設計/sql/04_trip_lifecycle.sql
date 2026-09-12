-- 検証用の空DBへ00、01、03適用後に追加するDDL設計案。
-- 既存データの移行・バックフィルは別途設計する。
BEGIN;
ALTER TABLE planning.trips
 ADD COLUMN created_by uuid NOT NULL REFERENCES identity.users(id),
 ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN started_at timestamptz,
 ADD COLUMN started_by uuid,
 ADD COLUMN finished_at timestamptz,
 ADD COLUMN finished_by uuid,
 ADD CONSTRAINT trip_starter_member FOREIGN KEY (id,started_by) REFERENCES planning.trip_participants(trip_id,user_id),
 ADD CONSTRAINT trip_finisher_member FOREIGN KEY (id,finished_by) REFERENCES planning.trip_participants(trip_id,user_id),
 ADD CONSTRAINT trip_lifecycle_fields CHECK (
  (status='planning' AND started_at IS NULL AND started_by IS NULL AND finished_at IS NULL AND finished_by IS NULL)
  OR (status='traveling' AND started_at IS NOT NULL AND started_by IS NOT NULL AND finished_at IS NULL AND finished_by IS NULL)
  OR (status='finished' AND started_at IS NOT NULL AND started_by IS NOT NULL AND finished_at IS NOT NULL AND finished_by IS NOT NULL AND finished_at >= started_at)
 );
CREATE INDEX trips_list_idx ON planning.trips(created_at DESC,id DESC);
CREATE INDEX trip_participants_user_idx ON planning.trip_participants(user_id,trip_id);
-- 状態の遷移順序・二人の同時登録・guard作成・再送はUseCaseのTXで保証する。
COMMIT;
