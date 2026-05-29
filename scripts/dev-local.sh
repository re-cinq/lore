#!/usr/bin/env bash
set -euo pipefail

# Boot the full Lore stack locally with live reload:
#   Postgres (docker) + shared (tsc --watch) + mcp-server + agent + web-ui.
# Idempotent — safe to re-run. Ctrl-C tears everything down (concurrently -k).
#
# Ports after start: web-ui :3000, mcp-server :3001, agent :8080, Postgres :5432.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PG_CONTAINER="lore-postgres"
PG_IMAGE="pgvector/pgvector:pg16"
PG_DATA_DIR="$ROOT/.lore-pgdata"

log() { echo "[lore] $*"; }
fail() { echo "[lore] ERROR: $*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "docker not found — needed for local Postgres"

# 1. Ensure Postgres is up. The :5432 host publish and the data bind mount are
#    fixed at create time, so a pre-existing container missing either is recreated
#    (docker start cannot add them). Inspecting config works while stopped too.
pg_config_ok() {
  local bindings mounts
  bindings="$(docker inspect -f '{{json .HostConfig.PortBindings}}' "$PG_CONTAINER" 2>/dev/null)"
  mounts="$(docker inspect -f '{{range .Mounts}}{{println .Source}}{{end}}' "$PG_CONTAINER" 2>/dev/null)"
  [[ "$bindings" == *'"5432/tcp"'* ]] && grep -qxF "$PG_DATA_DIR" <<<"$mounts"
}

create_pg() {
  log "Creating Postgres container '$PG_CONTAINER' ($PG_IMAGE), data in $PG_DATA_DIR"
  mkdir -p "$PG_DATA_DIR"
  docker run --name "$PG_CONTAINER" \
    -e POSTGRES_PASSWORD=lore -e POSTGRES_DB=lore \
    -v "$PG_DATA_DIR:/var/lib/postgresql/data" \
    -p 5432:5432 -d "$PG_IMAGE" >/dev/null
}

# Probe the *host* port — that is what the components actually connect to. The
# in-container pg_isready can pass while the host publish is inactive (a docker
# start that never re-established the forward), which looks healthy but isn't.
host_pg_ready() {
  local i
  for i in $(seq 1 "${1:-30}"); do
    (exec 3<>/dev/tcp/127.0.0.1/5432) 2>/dev/null && { exec 3>&-; return 0; }
    sleep 1
  done
  return 1
}

if docker ps -a --format '{{.Names}}' | grep -qx "$PG_CONTAINER" && ! pg_config_ok; then
  log "Existing '$PG_CONTAINER' lacks the :5432 publish or $PG_DATA_DIR mount — recreating"
  docker rm -f "$PG_CONTAINER" >/dev/null
fi

if docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
  log "Postgres container '$PG_CONTAINER' already running"
elif docker ps -a --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
  log "Starting existing Postgres container '$PG_CONTAINER'"
  docker start "$PG_CONTAINER" >/dev/null
else
  create_pg
fi

log "Waiting for Postgres on localhost:5432..."
if ! host_pg_ready 30; then
  log "Container is up but localhost:5432 is unreachable — recreating once to republish"
  docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
  create_pg
  host_pg_ready 30 || fail "Postgres did not become reachable on localhost:5432"
fi
log "Postgres ready on localhost:5432 (db=lore user=postgres password=lore)"
log "NOTE: schemas (lore, pipeline, memory, team schemas) are NOT auto-created."
log "      Components connect but queries will error until schemas exist."

# 2. Local DB env defaults — propagate to every child process below.
export LORE_DB_HOST=localhost
export LORE_DB_PORT=5432
export LORE_DB_NAME=lore
export LORE_DB_USER=postgres
export LORE_DB_PASSWORD=lore

# 3. web-ui deps live outside the workspace — install on first run.
if [ ! -d "$ROOT/web-ui/node_modules" ]; then
  log "Installing web-ui dependencies (first run)..."
  npm --prefix web-ui install
fi

# 4. Build once so 'node --watch dist/index.js' has something to run cold.
log "Building shared, mcp-server, agent..."
npm run build -w @re-cinq/lore-shared
npm run build -w @re-cinq/lore-mcp
npm run build -w @re-cinq/lore-agent

# 5. Run everything with live reload — one slot per process so -k kills all.
#    Each TS service gets a tsc --watch (recompile) + node --watch (restart) pair.
#    start:watch watches both ./dist and ../shared/dist, so a shared-package edit
#    recompiles (shared tsc) and restarts the dependent services too.
log "Starting all components..."
npx concurrently -k \
  -n "shared,mcp-tsc,mcp,agent-tsc,agent,ui" \
  -c "blue,green,greenBright,magenta,magentaBright,cyan" \
  "npm run dev -w @re-cinq/lore-shared" \
  "npm run dev -w @re-cinq/lore-mcp" \
  "PORT=3001 npm run start:watch -w @re-cinq/lore-mcp" \
  "npm run dev -w @re-cinq/lore-agent" \
  "npm run start:watch -w @re-cinq/lore-agent" \
  "npm --prefix web-ui run dev"
