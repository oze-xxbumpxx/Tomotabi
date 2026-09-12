-- M0 compatibility probe only. Not a production migration.
-- Do not treat this as the app schema. sql/00_validation_prerequisites.sql is also not a production migration.
CREATE SCHEMA IF NOT EXISTS infra;

CREATE TABLE IF NOT EXISTS infra.m0_probes (
    id text PRIMARY KEY,
    count integer NOT NULL CHECK (count >= 0)
);

INSERT INTO infra.m0_probes (id, count)
VALUES ('default', 0)
ON CONFLICT (id) DO NOTHING;
