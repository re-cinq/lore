#!/usr/bin/env bash
set -euo pipefail

# Prove the Helm hook installs the baseline on a managed-Postgres-shaped database
# (issue #3904): an EMPTY database `lore` owned by a NON-superuser role `lore`,
# nothing else. Runs ui-helm/files/migrate.sh (the hook's script) against it, then
# compares the schema with a database built the way our own cluster and local dev
# build theirs (setup-local-schema.sh, same team list). Any difference fails.
#
# Usage: scripts/ci/compare-baseline-install.sh [precreated|lore-creates|resume]
#   precreated    a server admin ran CREATE EXTENSION vector before the install
#   lore-creates  the hook's role has to create the extension itself; where the
#                 server refuses, the hook must say what an admin runs, and the
#                 next run continues after the admin has run it
#   resume        the first run breaks in 05_memory.sql; the second must resume
#                 after 04 and end with the same schema

VARIANT="${1:-precreated}"
IMAGE="${LORE_PG_IMAGE:-pgvector/pgvector:pg16}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHART_DIR="$REPO_ROOT/deploy/chart/charts/ui-helm"
SUFFIX="$$"
FRESH="lore-fresh-$SUFFIX"
REFERENCE="lore-reference-$SUFFIX"
WORK_DIR="$(mktemp -d)"

cleanup() {
  docker rm -f "$FRESH" "$REFERENCE" >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

log() { echo "[lore] $*"; }

start_postgres() {
  local name="$1"
  shift
  docker run -d --name "$name" -e POSTGRES_PASSWORD=postgres "$@" "$IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    docker exec "$name" pg_isready -U postgres >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "[lore] ERROR: $name did not become ready" >&2
  exit 1
}

superuser_psql() { docker exec -i "$1" psql -U postgres -v ON_ERROR_STOP=1 "${@:2}"; }

log "Starting the fresh database ($VARIANT): empty, owned by non-superuser role lore"
start_postgres "$FRESH" \
  -v "$CHART_DIR/baseline:/baseline:ro" \
  -v "$CHART_DIR/migrations:/migrations:ro" \
  -v "$CHART_DIR/files:/files:ro"
superuser_psql "$FRESH" -q <<'SQL'
CREATE ROLE lore LOGIN PASSWORD 'lore' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE lore OWNER lore;
SQL
if [ "$VARIANT" != "lore-creates" ]; then
  superuser_psql "$FRESH" -q -d lore -c 'CREATE EXTENSION vector;'
fi

run_hook() {
  docker exec \
    -e PGHOST=localhost -e PGPORT=5432 -e PGUSER=lore -e PGDATABASE=lore -e PGPASSWORD=lore \
    -e TEAM_SCHEMAS=org_shared "$@" \
    "$FRESH" sh /files/migrate.sh
}

expect_hook_failure() {
  if run_hook "$@" > "$WORK_DIR/failed-run.log" 2>&1; then
    echo "[lore] ERROR: the hook was expected to fail" >&2
    cat "$WORK_DIR/failed-run.log" >&2
    exit 1
  fi
  grep -E '^(\[migrate\]|psql)' "$WORK_DIR/failed-run.log"
}

log "First hook run on the empty database"
if [ "$VARIANT" = "resume" ]; then
  docker cp "$CHART_DIR/baseline" "$FRESH:/broken-baseline"
  docker exec "$FRESH" sh -c "echo 'SELECT 1/0;' >> /broken-baseline/05_memory.sql"
  expect_hook_failure -e BASELINE_DIR=/broken-baseline
  log "Rerun with the real baseline: must resume after 04_agent.sql"
fi
if [ "$VARIANT" = "lore-creates" ] && ! run_hook > "$WORK_DIR/first-run.log" 2>&1; then
  grep -E '^(\[migrate\]|psql)' "$WORK_DIR/first-run.log"
  grep -q 'CREATE EXTENSION IF NOT EXISTS vector;' "$WORK_DIR/first-run.log" \
    || { echo "[lore] ERROR: the failure did not print the statement an admin runs" >&2; exit 1; }
  log "The role cannot create the extension; an admin creates it and the install continues"
  superuser_psql "$FRESH" -q -d lore -c 'CREATE EXTENSION IF NOT EXISTS vector;'
  run_hook > "$WORK_DIR/first-run.log" 2>&1 || { cat "$WORK_DIR/first-run.log"; exit 1; }
elif [ "$VARIANT" != "lore-creates" ]; then
  run_hook > "$WORK_DIR/first-run.log" 2>&1 || { cat "$WORK_DIR/first-run.log"; exit 1; }
fi
grep -E '^\[migrate\] (baseline|done)' "$WORK_DIR/first-run.log"

log "Second hook run (nothing may apply, baseline recorded)"
run_hook > "$WORK_DIR/second-run.log" 2>&1 || { cat "$WORK_DIR/second-run.log"; exit 1; }
grep -E '^\[migrate\] (baseline|apply|done)' "$WORK_DIR/second-run.log"
if grep -qE '^\[migrate\] (baseline [0-9]|apply )' "$WORK_DIR/second-run.log"; then
  echo "[lore] ERROR: the second run applied something" >&2
  exit 1
fi

log "Building the reference database with setup-local-schema.sh (org_shared only)"
start_postgres "$REFERENCE" -e POSTGRES_DB=lore
LORE_PG_CONTAINER="$REFERENCE" LORE_TEAM_SCHEMAS=org_shared \
  bash "$REPO_ROOT/scripts/infra/setup-local-schema.sh" > "$WORK_DIR/reference.log" 2>&1 \
  || { tail -30 "$WORK_DIR/reference.log"; exit 1; }

dump_schema() {
  docker exec "$1" pg_dump -U postgres -d lore --schema-only --no-owner --no-privileges \
    | grep -v -E '^\\(un)?restrict '
}
dump_schema "$FRESH" > "$WORK_DIR/fresh.sql"
dump_schema "$REFERENCE" > "$WORK_DIR/reference.sql"

if diff -u "$WORK_DIR/reference.sql" "$WORK_DIR/fresh.sql" > "$WORK_DIR/schema.diff"; then
  log "OK: hook-installed schema equals the setup-local-schema.sh schema ($(wc -l < "$WORK_DIR/fresh.sql") dump lines)."
else
  echo "[lore] ERROR: the hook-installed schema differs from the setup-local-schema.sh schema:" >&2
  cat "$WORK_DIR/schema.diff" >&2
  exit 1
fi
