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

log() { echo "[lore] $*"; }

docker inspect "$CONTAINER" >/dev/null 2>&1 \
  || { echo "[lore] ERROR: container '$CONTAINER' not found — run 'npm run db:up' first" >&2; exit 1; }

# On a restart over a persisted data dir, the postmaster opens its port before
# crash recovery finishes, so a bare TCP probe passes while queries still get
# "FATAL: the database system is starting up". Gate on an actual query through
# the same docker-exec path the DDL below uses.
log "Waiting for Postgres to accept queries..."
ready=0
for _ in $(seq 1 60); do
  if docker exec -i "$CONTAINER" psql -U postgres -d lore -tAc 'SELECT 1' >/dev/null 2>&1; then
    ready=1; break
  fi
  sleep 1
done
[ "$ready" -eq 1 ] \
  || { echo "[lore] ERROR: Postgres did not become ready to accept queries within 60s" >&2; exit 1; }

# The GKE schemas GRANT to the 'lore' role and web-ui logs in as 'lore_ui';
# both pre-exist in the cluster but not in a fresh container. Create them first.
log "Ensuring roles, pgvector extension, and team chunk schemas..."
docker exec -i "$CONTAINER" psql -U postgres -d lore -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore') THEN
    CREATE ROLE lore LOGIN PASSWORD 'lore';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
    CREATE ROLE lore_ui LOGIN PASSWORD 'lore';
  END IF;
END $$;

-- Team chunk schemas + chunks tables (mirrors setup-db.sh's CNPG block, which
-- is kubectl-bound and does not run locally).
DO $$
DECLARE s TEXT;
BEGIN
  FOREACH s IN ARRAY ARRAY['payments', 'platform', 'mobile', 'data', 'org_shared']
  LOOP
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', s);
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.chunks (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        content       TEXT NOT NULL,
        embedding     VECTOR(768),
        content_type  TEXT,
        team          TEXT,
        repo          TEXT,
        file_path     TEXT,
        author        TEXT,
        ingested_at   TIMESTAMPTZ DEFAULT NOW(),
        metadata      JSONB,
        search_tsv    TSVECTOR GENERATED ALWAYS AS (to_tsvector(''english'', content)) STORED
      )', s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_chunks_embedding_idx ON %I.chunks USING hnsw (embedding vector_cosine_ops)', s, s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_chunks_search_idx ON %I.chunks USING GIN (search_tsv)', s, s);
  END LOOP;
END $$;
SQL

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
exec docker exec -i "$CONTAINER" "\${cmd[@]}"
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
docker exec -i "$CONTAINER" psql -U postgres -d lore -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
GRANT CREATE ON DATABASE lore TO lore;
GRANT CREATE, USAGE ON SCHEMA lore, payments, platform, mobile, data, org_shared TO lore;
ALTER TABLE IF EXISTS lore.schema_migrations OWNER TO lore;
SQL

# Incremental migrations. The GKE Helm hook (migrate-job.yaml) applies these on
# every deploy as the 'lore' role, tracked in lore.schema_migrations; local dev
# has no such hook. Mirror the hook exactly — same role, tracking table, filename
# order, per-file single transaction, skip-if-applied — so a migration the 'lore'
# role cannot apply (e.g. DDL on a schema it lacks CREATE on) fails here too,
# instead of silently passing as superuser and only breaking on deploy.
MIGRATIONS_DIR="$DIR/../../terraform/modules/gke-mcp/ui-helm/migrations"
psql() { docker exec -i "$CONTAINER" psql -U lore -d lore "$@"; }
log "Applying migrations from $MIGRATIONS_DIR (as role 'lore')"
psql -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE SCHEMA IF NOT EXISTS lore;
CREATE TABLE IF NOT EXISTS lore.schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
SQL
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ -e "$f" ] || continue
  v="$(basename "$f")"
  if [ "$(psql -tA -c "SELECT 1 FROM lore.schema_migrations WHERE version = '$v'")" = "1" ]; then
    log "migrate skip   $v (already applied)"
    continue
  fi
  log "migrate apply  $v"
  psql -v ON_ERROR_STOP=1 --single-transaction -f - -c "INSERT INTO lore.schema_migrations (version) VALUES ('$v')" < "$f"
done

log "Local schema applied to '$CONTAINER'."
