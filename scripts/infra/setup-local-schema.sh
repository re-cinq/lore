#!/usr/bin/env bash
set -euo pipefail

# Apply all Lore schema DDL to the LOCAL docker Postgres container.
#
# DRY: instead of duplicating the SQL, this shims `kubectl` so the existing
# setup-*.sh scripts (which call `kubectl exec -n NS POD -- psql ...`) run
# unmodified, with their psql commands redirected into the container.
# All DDL uses CREATE ... IF NOT EXISTS, so re-running is safe.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER="${LORE_PG_CONTAINER:-lore-postgres}"

# How to reach Postgres. `docker` (default) execs inside the local dev container;
# `tcp` connects over PG* env vars, which is what CI has — a service container on
# localhost with no docker CLI in the job.
#
# The TRANSPORT is the only difference between the two environments. Everything
# after it — role bootstrap, the setup-*.sh chain, the ownership reconcile, the
# migration loop — is shared, deliberately: a CI database built by a second,
# parallel script is a database whose shape nobody has checked against the one
# production gets, and a test passing against it reports confidence it has not
# earned.
TRANSPORT="${LORE_SCHEMA_TRANSPORT:-docker}"

# Who to bootstrap as. The dev container ships a `postgres` superuser; a CI
# service container's superuser is whatever POSTGRES_USER it was given, so the
# caller names it.
SUPERUSER="${LORE_SCHEMA_SUPERUSER:-postgres}"

# Team schemas the baseline creates (each with a chunks table). The cluster
# path (setup-db.sh) takes the same list; the Helm hook on a fresh managed
# database takes only org_shared, and CI sets that here to compare the two.
TEAM_SCHEMAS="${LORE_TEAM_SCHEMAS:-payments,platform,mobile,data,org_shared}"

CHART_DIR="$DIR/../../deploy/chart/charts/ui-helm"
BASELINE_DIR="$CHART_DIR/baseline"

log() { echo "[lore] $*"; }

# Run psql as $1; remaining args and stdin pass through.
pg() {
  local role="$1"
  shift

  # `lore` on BOTH transports, deliberately: the setup-*.sh chain connects with
  # `-d lore` hardcoded (matching the cluster), so any other value here would
  # build half the schema in one database and half in another. Honouring
  # $PGDATABASE would make a developer with it set in their shell silently
  # target the wrong database — a footgun, not flexibility.
  if [ "$TRANSPORT" = "docker" ]; then
    docker exec -i "$CONTAINER" psql -U "$role" -d lore "$@"
  else
    command psql -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" \
      -U "$role" -d lore "$@"
  fi
}

if [ "$TRANSPORT" = "docker" ]; then
  docker inspect "$CONTAINER" >/dev/null 2>&1 \
    || { echo "[lore] ERROR: container '$CONTAINER' not found — run 'npm run db:up' first" >&2; exit 1; }
fi

# On a restart over a persisted data dir, the postmaster opens its port before
# crash recovery finishes, so a bare TCP probe passes while queries still get
# "FATAL: the database system is starting up". Gate on an actual query through
# the same docker-exec path the DDL below uses.
log "Waiting for Postgres to accept queries..."
ready=0
for _ in $(seq 1 60); do
  if pg "$SUPERUSER" -tAc 'SELECT 1' >/dev/null 2>&1; then
    ready=1; break
  fi
  sleep 1
done
[ "$ready" -eq 1 ] \
  || { echo "[lore] ERROR: Postgres did not become ready to accept queries within 60s" >&2; exit 1; }

# The GKE schemas GRANT to the 'lore' role and web-ui logs in as 'lore_ui';
# both pre-exist in the cluster but not in a fresh container. Create them first.
log "Ensuring roles, pgvector extension, and team chunk schemas..."
pg "$SUPERUSER" -v ON_ERROR_STOP=1 -f - >/dev/null < "$BASELINE_DIR/01_extension.sql"
pg "$SUPERUSER" -v ON_ERROR_STOP=1 -f - >/dev/null < "$DIR/setup-local-roles.sql"
pg "$SUPERUSER" -v ON_ERROR_STOP=1 --single-transaction -v team_schemas="$TEAM_SCHEMAS" -f - >/dev/null < "$BASELINE_DIR/07_team_chunks.sql"

# Over tcp the shimmed `psql -U postgres` authenticates for real, and the role
# created above has no password — so give it the one this run is using. Not needed
# for the docker transport, where the connection is local and trusted.
#
# Found by CI: a connection from INSIDE the container matches a `trust` pg_hba
# line, so the local rehearsal passed while the runner — reaching the service
# container across the bridge — hit `scram-sha-256` and failed.
if [ "$TRANSPORT" != "docker" ] && [ -n "${PGPASSWORD:-}" ]; then
  log "Setting the bootstrap superuser's password for tcp auth"
  pg "$SUPERUSER" -v ON_ERROR_STOP=1 -q \
    -c "ALTER ROLE postgres PASSWORD \$\$${PGPASSWORD}\$\$" >/dev/null
fi

# kubectl shim: run whatever follows `--` inside the container instead of a pod.
SHIM_DIR="$(mktemp -d)"
trap 'rm -rf "$SHIM_DIR"' EXIT
cat > "$SHIM_DIR/kubectl" <<SHIM
#!/usr/bin/env bash
set -euo pipefail
cmd=()
seen=0
for a in "\$@"; do
  if [ "\$seen" -eq 1 ]; then cmd+=("\$a"); continue; fi
  if [ "\$a" = "--" ]; then seen=1; fi
done
# Non-exec kubectl calls (get/wait/etc.) have no '--' — treat as no-op success.
[ "\$seen" -eq 1 ] && [ "\${#cmd[@]}" -gt 0 ] || exit 0
if [ "$TRANSPORT" = "docker" ]; then
  exec docker exec -i "$CONTAINER" "\${cmd[@]}"
fi
exec "\${cmd[@]}"
SHIM
chmod +x "$SHIM_DIR/kubectl"
export PATH="$SHIM_DIR:$PATH"

# Order matters: pipeline before dark-factory (FK references into pipeline.*).
for s in setup-repos-schema setup-pipeline-schema setup-agent-schema \
         setup-memory-schema setup-dark-factory-schema; do
  log "applying $s.sh"
  bash "$DIR/$s.sh"
done

# Grant 'lore' the privileges it has in the cluster: it owns the DB there
# (CNPG initdb owner) and its own schema, and team schemas are GRANTed
# CREATE/USAGE (setup-db.sh + ui-helm/migrations/README handoff). Mirror that
# locally so the migration runner — which connects as 'lore' below — can DDL
# these schemas. Also hand any pre-existing schema_migrations to lore so a DB
# previously seeded as postgres converges.
#
# Ownership reconcile: the setup-*.sh scripts run as 'postgres', so pipeline.*
# and memory.* tables they create are postgres-owned — but migrations run as
# 'lore', and ALTER TABLE needs ownership (GRANT ALL does not include it). On GKE
# the lore-db-helm ownership-reconciler-job hands these to 'lore' on every
# deploy; local dev has no such job, so a migration like
# 0003 (ALTER pipeline.job_runs, created by setup-agent-schema.sh) would fail
# with "must be owner". Reconcile here, idempotently, via the local socket as
# postgres (not a network superuser) so the local chain matches the cluster.
pg "$SUPERUSER" -v ON_ERROR_STOP=1 -v team_schemas="$TEAM_SCHEMAS" -f - >/dev/null < "$DIR/setup-local-ownership.sql"

# Baseline check and incremental migrations: the SAME script the GKE Helm hook
# runs (ui-helm/files/migrate.sh), as the same role ('lore'), tracked in
# lore.schema_migrations, so a migration the 'lore' role cannot apply (e.g. DDL
# on a schema it lacks CREATE on) fails here too, instead of silently passing as
# superuser and only breaking on deploy. The baseline above came from the
# setup-*.sh scripts, so the script finds it present and skips it. Over the
# docker transport psql lives in the container, so a psql shim stands in.
log "Applying migrations from $CHART_DIR/migrations (as role 'lore')"
MIGRATE_SHIM_DIR="$(mktemp -d)"
trap 'rm -rf "$SHIM_DIR" "$MIGRATE_SHIM_DIR"' EXIT
if [ "$TRANSPORT" = "docker" ]; then
  cat > "$MIGRATE_SHIM_DIR/psql" <<SHIM
#!/bin/sh
exec docker exec -i "$CONTAINER" psql -U lore -d lore "\$@"
SHIM
  chmod +x "$MIGRATE_SHIM_DIR/psql"
fi
PATH="$MIGRATE_SHIM_DIR:$PATH" \
  PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER=lore PGDATABASE=lore \
  MIGRATIONS_DIR="$CHART_DIR/migrations" BASELINE_DIR="$BASELINE_DIR" TEAM_SCHEMAS="$TEAM_SCHEMAS" \
  sh "$CHART_DIR/files/migrate.sh"

log "Local schema applied to '$CONTAINER'."
