#!/bin/sh
# Local development only: runs the administrator procedure inside the compose postgres container
# on first start (empty volume). Production uses the same two SQL files by hand.
set -eu
psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v migrator_password="$LOCAL_MIGRATOR_PASSWORD" \
  -v app_runtime_password="$LOCAL_APP_RUNTIME_PASSWORD" \
  -f /tomotabi/create-roles.sql
psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -f /tomotabi/grant-database.sql
