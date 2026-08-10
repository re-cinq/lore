#!/usr/bin/env bash
set -euo pipefail

# Copy the prod lore-db into the local dev Postgres.
#
#   scripts/infra/pull-prod-db.sh                  # inspect + dump to .lore-dumps/, no local writes
#   scripts/infra/pull-prod-db.sh --restore        # ...then load it into the local docker Postgres
#   scripts/infra/pull-prod-db.sh --restore --with-pipeline   # include the work queues (see below)
#
# Dump and restore are separate on purpose: the restore DROPS the local copy of every
# schema it loads, and that is not something to discover from a flag you did not type.
# Re-running the dump is cheap; re-creating local data you did not know you had is not.
#
# The `pipeline` schema is EXCLUDED by default, and that exclusion is the whole reason
# this script is not a one-line pg_dump. It holds work in flight, and both Floor queues
# claim on status alone — no repo filter, no owning-instance filter:
#
#     pipeline.events: WHERE status IN ('pending','failed') AND next_attempt_at <= now()
#     pipeline.tasks:  WHERE status = 'pending'
#
# A laptop Floor restored from prod would therefore claim PRODUCTION webhook events and
# pending tasks and act on them for real: dispatch agents, open issues and PRs, and run
# the auto-merge handler — with the GitHub credentials in .env.local. Context (memory,
# chunks, repo settings) is what makes local work feel like prod; the queue is what
# makes it dangerous. --with-pipeline restores it anyway and then quiesces every
# claimable row, for when you want the run history in the UI.
#
# pg_dump runs INSIDE the primary pod rather than over a `kubectl port-forward`. The
# tunnel version raced: port-forward binds its local socket before the upstream is ready
# and drops the listener when a connection is opened and closed again — which a
# readiness probe does by definition, so the probe passed and the very next connect got
# ECONNREFUSED. Executing in the pod removes the tunnel, the probe, and the need for a
# local pg_dump binary (there is none) in one go.
#
# Prereqs: gcloud auth login (the GKE context is credentialed through it), kubectl, and
# docker for the local restore.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTEXT="${LORE_DB_CONTEXT:-gke_re5-n8n-platform_europe-west1_n8n-cluster}"
NAMESPACE="${LORE_DB_NAMESPACE:-lore-db}"
DB_NAME="${LORE_DB_NAME:-lore}"
DUMP_DIR="$ROOT/.lore-dumps"

log() { echo "[lore] $*"; }
fail() { echo "[lore] ERROR: $*" >&2; exit 1; }

RESTORE=0
WITH_PIPELINE=0
for arg in "$@"; do
  case "$arg" in
    --restore) RESTORE=1 ;;
    --with-pipeline) WITH_PIPELINE=1 ;;
    *) fail "unknown argument: $arg (expected --restore and/or --with-pipeline)" ;;
  esac
done

for bin in kubectl gcloud; do
  command -v "$bin" >/dev/null 2>&1 || fail "$bin not found"
done
gcloud auth print-access-token >/dev/null 2>&1 \
  || fail "gcloud credentials expired — run: gcloud auth login"

KC="kubectl --context=$CONTEXT -n $NAMESPACE"

# The CloudNativePG primary. Dumping from a replica would be valid but can lag; the
# label is the cluster's own, so it follows a failover instead of pinning to a pod name.
POD="$($KC get pods -l cnpg.io/instanceRole=primary -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
[ -n "$POD" ] || fail "no primary pod found in $NAMESPACE (context: $CONTEXT) — is the cluster up?"
log "Primary: $POD"

# Peer auth over the pod's local socket: no password crosses the wire, none lands in
# argv inside the pod where another process could read it out of `ps`.
in_pod() { $KC exec -i "$POD" -c postgres -- "$@"; }

SCHEMAS="$(in_pod psql -U postgres -d "$DB_NAME" -At -c \
  "select nspname from pg_namespace
    where nspname not like 'pg\_%' and nspname <> 'information_schema'
    order by nspname" | tr -d '\r')" \
  || fail "could not list schemas — check that '$POD' is the CloudNativePG primary"
[ -n "$SCHEMAS" ] || fail "no schemas found in $DB_NAME"

if [ "$WITH_PIPELINE" -eq 0 ]; then
  SCHEMAS="$(printf '%s\n' "$SCHEMAS" | grep -vx pipeline || true)"
  log "Excluding the 'pipeline' schema (work queues) — pass --with-pipeline to include it"
fi

log "Schemas and sizes:"
in_pod psql -U postgres -d "$DB_NAME" -c \
  "select nspname as schema, pg_size_pretty(sum(pg_total_relation_size(c.oid))::bigint) as size
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where nspname not like 'pg\_%' and nspname <> 'information_schema'
    group by 1 order by sum(pg_total_relation_size(c.oid)) desc"

mkdir -p "$DUMP_DIR"
chmod 700 "$DUMP_DIR"
DUMP_FILE="$DUMP_DIR/lore-$(date +%Y%m%d-%H%M%S).dump"

# Custom format: one file, and selective on the way back out if it turns out you only
# wanted `memory` after all (pg_restore --schema=memory, no re-pull).
schema_args=()
for s in $SCHEMAS; do schema_args+=(--schema="$s"); done
log "Dumping $(echo "$SCHEMAS" | wc -w) schemas..."
in_pod pg_dump -U postgres -d "$DB_NAME" \
  --format=custom --no-owner --no-privileges "${schema_args[@]}" \
  > "$DUMP_FILE" || fail "pg_dump failed"
[ -s "$DUMP_FILE" ] || fail "pg_dump produced an empty file"
chmod 600 "$DUMP_FILE"
log "Wrote $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"

if [ "$RESTORE" -eq 0 ]; then
  log ""
  log "Dump only — nothing local was touched. To load it:"
  log "  $0 --restore"
  exit 0
fi

command -v docker >/dev/null 2>&1 || fail "docker not found — needed for the local restore"
docker ps --format '{{.Names}}' | grep -qx lore-postgres \
  || fail "local Postgres container 'lore-postgres' is not running — start it with: npm run db:up"

log ""
log "RESTORE will DROP and recreate these schemas in the LOCAL database:"
log "  $(echo "$SCHEMAS" | tr '\n' ' ')"
read -r -p "       Type 'yes' to continue: " confirm
[ "$confirm" = "yes" ] || fail "aborted — the dump is kept at $DUMP_FILE"

# --clean --if-exists so a schema that setup-local-schema.sh already created is replaced
# rather than colliding row by row. pg_restore's default is to continue past errors,
# which is what we want here and why --exit-on-error is absent: extension and role grants
# routinely differ between a CloudNativePG cluster and a docker Postgres, and those
# failures say nothing about the data.
docker exec -i -e PGPASSWORD=lore lore-postgres \
  pg_restore -h 127.0.0.1 -U postgres -d lore \
  --clean --if-exists --no-owner --no-privileges \
  < "$DUMP_FILE" 2>&1 | tail -20 || true

# Quiesce anything claimable. The restore copied prod's queues verbatim, and the local
# Floor polls them the moment it starts — so terminate every row a claim query can see
# BEFORE that happens. Cheap, idempotent, and the failure mode it prevents is a laptop
# opening PRs against live repos.
if [ "$WITH_PIPELINE" -eq 1 ]; then
  docker exec -i -e PGPASSWORD=lore lore-postgres \
    psql -h 127.0.0.1 -U postgres -d lore -v ON_ERROR_STOP=1 <<'SQL'
UPDATE pipeline.events
   SET status = 'done', handled_at = now()
 WHERE status IN ('pending', 'failed', 'processing');
UPDATE pipeline.tasks
   SET status = 'cancelled'
 WHERE status IN ('pending', 'queued', 'running');
DELETE FROM pipeline.task_leases;
SQL
  log "Quiesced pipeline.events + pipeline.tasks and cleared leases — nothing is claimable"
fi

log "Restored into the local Postgres (db=lore user=postgres)."
log "Dump kept at $DUMP_FILE — delete it when you are done; it is org data in the clear."
