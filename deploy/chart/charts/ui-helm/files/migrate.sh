set -eu

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"
BASELINE_DIR="${BASELINE_DIR:-/baseline}"
TEAM_SCHEMAS="${TEAM_SCHEMAS:-org_shared}"
BASELINE_VERSION="0000_baseline"

echo "[migrate] waiting for $PGUSER@$PGHOST:$PGPORT/$PGDATABASE ..."
i=0
until psql -c 'SELECT 1' >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "[migrate] ERROR: database unreachable after 60s; last attempt:" >&2
    psql -c 'SELECT 1' || true
    exit 1
  fi
  sleep 2
done
psql -v ON_ERROR_STOP=1 \
  -c "CREATE SCHEMA IF NOT EXISTS lore;" \
  -c "CREATE TABLE IF NOT EXISTS lore.schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());"

# Files are fed on stdin so the same script runs where psql is not next to the
# files (the local docker transport of setup-local-schema.sh).
apply_file() {
  file="$1"
  version="$2"
  psql -v ON_ERROR_STOP=1 --single-transaction -v team_schemas="$TEAM_SCHEMAS" \
    -f - \
    -c "INSERT INTO lore.schema_migrations (version) VALUES ('$version')" < "$file"
}

# The baseline is the first-install path for a database nobody provisioned by
# hand (a managed Postgres: no pod to exec into, no superuser, only the role
# that owns the database). Rule: take it when the 0000_baseline marker is
# missing AND either pipeline.tasks does not exist (fresh database) OR some
# per-file progress row exists (a baseline that stopped midway). A database
# with pipeline.tasks and no progress row was provisioned by the setup-*.sh
# scripts, and the baseline never runs on it. Each file records its own
# progress row in its transaction, so a retry resumes after the last file that
# committed, and the marker is written only after every file has.
baseline_marker=$(psql -tA -c "SELECT 1 FROM lore.schema_migrations WHERE version = '$BASELINE_VERSION'")
has_pipeline_tasks=$(psql -tA -c "SELECT to_regclass('pipeline.tasks') IS NOT NULL")
has_baseline_progress=$(psql -tA -c "SELECT 1 FROM lore.schema_migrations WHERE version LIKE '$BASELINE_VERSION/%' LIMIT 1")
if [ "$baseline_marker" = "1" ] || { [ "$has_pipeline_tasks" = "t" ] && [ -z "$has_baseline_progress" ]; }; then
  echo "[migrate] baseline present, skipping"
else
  for f in "$BASELINE_DIR"/*.sql; do
    v="$BASELINE_VERSION/$(basename "$f")"
    applied=$(psql -tA -c "SELECT 1 FROM lore.schema_migrations WHERE version = '$v'")
    if [ "$applied" = "1" ]; then
      echo "[migrate] baseline skip $(basename "$f") (already applied)"
      continue
    fi
    echo "[migrate] baseline $(basename "$f")"
    if ! apply_file "$f" "$v"; then
      if [ "$(basename "$f")" = "01_extension.sql" ]; then
        echo "[migrate] ERROR: the role $PGUSER cannot create the vector extension." >&2
        echo "[migrate] A server admin has to run this once, in database $PGDATABASE:" >&2
        echo "[migrate]   CREATE EXTENSION IF NOT EXISTS vector;" >&2
        echo "[migrate] On Azure the extension must also be allow-listed in the azure.extensions server parameter." >&2
        echo "[migrate] The next helm upgrade --install continues from here." >&2
      fi
      exit 1
    fi
  done
  psql -v ON_ERROR_STOP=1 -c "INSERT INTO lore.schema_migrations (version) VALUES ('$BASELINE_VERSION') ON CONFLICT DO NOTHING"
fi

for f in "$MIGRATIONS_DIR"/*.sql; do
  v=$(basename "$f")
  applied=$(psql -tA -c "SELECT 1 FROM lore.schema_migrations WHERE version = '$v'")
  if [ "$applied" = "1" ]; then
    echo "[migrate] skip   $v (already applied)"
    continue
  fi
  echo "[migrate] apply  $v"
  apply_file "$f" "$v"
done
echo "[migrate] done"
