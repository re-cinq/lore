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

# The GKE schemas GRANT to the 'lore' role and web-ui logs in as 'lore_ui';
# both pre-exist in the cluster but not in a fresh container. Create them first.
log "Ensuring roles (lore, lore_ui) and pgvector extension..."
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

log "Local schema applied to '$CONTAINER'."
