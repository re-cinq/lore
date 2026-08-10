#!/usr/bin/env bash
set -euo pipefail

# Copy the prod Dgraph (memory graph + spec-traceability graph — one shared instance,
# see infra/terraform/lore-dgraph.tf) into the local dev Dgraph.
#
#   scripts/infra/pull-prod-graph.sh                    # export + fetch, nothing local touched
#   scripts/infra/pull-prod-graph.sh --restore          # ...then load it locally
#   scripts/infra/pull-prod-graph.sh --restore-from DIR # load an export already fetched
#
# Sibling of pull-prod-db.sh, same shape and the same reasons: dump and restore are
# separate because the load DROPS the local graph, and --restore-from skips the cluster
# so a failed local load never costs a second transfer.
#
# No queue hazard here, unlike the SQL side — the graph is derived data, projected by CI
# on push to main, so there is nothing a local Floor can claim out of it.
#
# Files come out one `kubectl exec … cat` at a time rather than via `kubectl cp`: cp
# shells out to tar inside the container, and a single-file read retries cleanly when the
# API server resets the stream, which it does on transfers this size (see pull-prod-db.sh).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTEXT="${LORE_DB_CONTEXT:-gke_re5-n8n-platform_europe-west1_n8n-cluster}"
NAMESPACE="${LORE_DGRAPH_NAMESPACE:-lore-dgraph}"
LOCAL_CONTAINER="${LORE_DGRAPH_CONTAINER:-lore-dgraph}"
DUMP_DIR="$ROOT/.lore-dumps"

log() { echo "[lore] $*"; }
fail() { echo "[lore] ERROR: $*" >&2; exit 1; }

RESTORE=0
RESTORE_FROM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --restore) RESTORE=1 ;;
    --restore-from) RESTORE_FROM="${2:?--restore-from needs a path}"; RESTORE=1; shift ;;
    *) fail "unknown argument: $1 (expected --restore, --restore-from PATH)" ;;
  esac
  shift
done

if [ -z "$RESTORE_FROM" ]; then

for bin in kubectl gcloud; do
  command -v "$bin" >/dev/null 2>&1 || fail "$bin not found"
done
gcloud auth print-access-token >/dev/null 2>&1 \
  || fail "gcloud credentials expired — run: gcloud auth login"

KC="kubectl --context=$CONTEXT -n $NAMESPACE"
POD="$($KC get pods -l app=lore-dgraph -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
[ -n "$POD" ] || fail "no lore-dgraph pod found in $NAMESPACE (context: $CONTEXT)"
log "Alpha: $POD"

in_pod() { $KC exec -i "$POD" -- "$@"; }

# Dgraph writes the export to its own volume and answers with a status, not the data.
# The image ships curl (the local compose healthcheck relies on it), so this needs no
# port-forward.
log "Triggering export (rdf)..."
EXPORT_REPLY="$(in_pod curl -s -X POST localhost:8080/admin \
  -H 'Content-Type: application/json' \
  -d '{"query":"mutation { export(input: {format: \"rdf\"}) { response { message code } } }"}')"
echo "$EXPORT_REPLY" | grep -qi "success" \
  || fail "export did not report success: $EXPORT_REPLY"

# Newest export directory. Dgraph names them dgraph.r<readTs>.u<timestamp>, so the most
# recently modified one is the export just taken.
EXPORT_SUBDIR="$(in_pod bash -c 'ls -1t /dgraph/export 2>/dev/null | head -1' | tr -d '\r')"
[ -n "$EXPORT_SUBDIR" ] || fail "no export directory under /dgraph/export"
log "Export: $EXPORT_SUBDIR"

FILES="$(in_pod bash -c "ls -1 /dgraph/export/$EXPORT_SUBDIR" | tr -d '\r')"
[ -n "$FILES" ] || fail "export directory $EXPORT_SUBDIR is empty"

mkdir -p "$DUMP_DIR"
chmod 700 "$DUMP_DIR"
FETCH_DIR="$DUMP_DIR/graph-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$FETCH_DIR"

# `cat` per file, binary-safe (no -t, so no TTY translation), retried like the SQL dumps.
for f in $FILES; do
  target="$FETCH_DIR/$f"
  attempt=1
  until in_pod cat "/dgraph/export/$EXPORT_SUBDIR/$f" > "$target" && [ -s "$target" ]; do
    attempt=$((attempt + 1))
    [ "$attempt" -gt 3 ] && fail "fetching $f failed after 3 attempts"
    log "  $f: transfer failed — retry $attempt/3"
    sleep 3
  done
  log "  $f -> $(du -h "$target" | cut -f1)"
done
chmod 600 "$FETCH_DIR"/*
log "Wrote $FETCH_DIR ($(du -sh "$FETCH_DIR" | cut -f1) total)"

if [ "$RESTORE" -eq 0 ]; then
  log ""
  log "Export only — nothing local was touched. To load it:"
  log "  $0 --restore-from $FETCH_DIR"
  exit 0
fi
RESTORE_FROM="$FETCH_DIR"

fi  # end of the pull phase

[ -d "$RESTORE_FROM" ] || fail "not a directory: $RESTORE_FROM"
RDF="$(ls -1 "$RESTORE_FROM"/*.rdf.gz 2>/dev/null | head -1 || true)"
SCHEMA="$(ls -1 "$RESTORE_FROM"/*.schema.gz 2>/dev/null | head -1 || true)"
[ -n "$RDF" ] || fail "no .rdf.gz in $RESTORE_FROM"
[ -n "$SCHEMA" ] || fail "no .schema.gz in $RESTORE_FROM"

command -v docker >/dev/null 2>&1 || fail "docker not found — needed for the local load"
docker ps --format '{{.Names}}' | grep -qx "$LOCAL_CONTAINER" \
  || fail "local Dgraph container '$LOCAL_CONTAINER' is not running — start it with: npm run dgraph:up"

log ""
log "RESTORE will DROP the entire local graph and replace it with this export."
log "  data:   $(basename "$RDF")"
log "  schema: $(basename "$SCHEMA")"
read -r -p "       Type 'yes' to continue: " confirm
[ "$confirm" = "yes" ] || fail "aborted — the export is kept at $RESTORE_FROM"

# drop_all, not a plain load. `dgraph live` MERGES into whatever is there, so loading
# onto an existing local graph would leave a hybrid: prod's nodes plus whatever local
# development had already projected, with no way to tell them apart afterwards.
log "Dropping the local graph..."
docker exec -i "$LOCAL_CONTAINER" \
  curl -s -X POST localhost:8080/alter -d '{"drop_all": true}' >/dev/null \
  || fail "drop_all failed"

# The live loader talks to zero (:5080) and alpha (:9080). compose publishes only alpha's
# ports to the host, so this runs INSIDE the container where both are on localhost.
docker cp "$RDF" "$LOCAL_CONTAINER:/tmp/import.rdf.gz" >/dev/null
docker cp "$SCHEMA" "$LOCAL_CONTAINER:/tmp/import.schema.gz" >/dev/null
log "Loading..."
docker exec -i "$LOCAL_CONTAINER" \
  dgraph live -f /tmp/import.rdf.gz -s /tmp/import.schema.gz \
  -a localhost:9080 -z localhost:5080 2>&1 | tail -12
docker exec -i "$LOCAL_CONTAINER" rm -f /tmp/import.rdf.gz /tmp/import.schema.gz

log "Loaded into the local Dgraph (http://localhost:8081, grpc localhost:9080)."
log "Export kept at $RESTORE_FROM — delete it when you are done; it is org data in the clear."
