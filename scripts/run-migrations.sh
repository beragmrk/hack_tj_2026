#!/usr/bin/env bash
set -euo pipefail

DB_URL="${DATABASE_URL:-postgresql://pulsemesh:pulsemesh@localhost:5432/pulsemesh}"
MIGRATION_DIR="infra/db/migrations"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required but was not found in PATH"
  exit 1
fi

for file in "${MIGRATION_DIR}"/*.sql; do
  echo "Applying ${file}"
  psql "${DB_URL}" -v ON_ERROR_STOP=1 -f "${file}"
done

echo "All migrations applied successfully."
