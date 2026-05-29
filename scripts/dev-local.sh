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

# 1b. Apply schema DDL (idempotent — CREATE ... IF NOT EXISTS).
bash "$ROOT/scripts/infra/setup-local-schema.sh"

# 2. Local DB env defaults — propagate to every child process below.
export LORE_DB_HOST=localhost
export LORE_DB_PORT=5432
export LORE_DB_NAME=lore
export LORE_DB_USER=postgres
export LORE_DB_PASSWORD=lore

# 2b. web-ui auth (NextAuth). Needs a URL + secret locally. Generate the secret
#     once and persist it (gitignored) so sessions survive restarts. GitHub OAuth
#     creds must be supplied by the user (exported before 'npm start').
export NEXTAUTH_URL="http://localhost:3000"
SECRET_FILE="$ROOT/.lore-nextauth-secret"
if [ ! -s "$SECRET_FILE" ]; then
  (openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64) > "$SECRET_FILE"
fi
export NEXTAUTH_SECRET="$(cat "$SECRET_FILE")"

if [ -z "${GITHUB_OAUTH_CLIENT_ID:-}" ] || [ -z "${GITHUB_OAUTH_CLIENT_SECRET:-}" ]; then
  log "WARNING: GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET not set — web-ui login will fail."
  log "         Create a GitHub OAuth app with callback http://localhost:3000/api/auth/callback/github,"
  log "         then export both vars before running 'npm start'."
fi

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
#
#    Teardown: concurrently runs via setsid in its OWN process group, detached
#    from the TTY. Ctrl-C reaches only this script, whose trap signals the whole
#    group — node --watch children ignore plain SIGTERM, so we escalate to
#    SIGKILL. This guarantees a clean stop with no orphaned watchers.
STACK_PGID=""
cleanup() {
  trap - INT TERM EXIT
  [ -n "$STACK_PGID" ] || exit 0
  log "Stopping all components..."
  kill -TERM "-$STACK_PGID" 2>/dev/null || true
  for _ in 1 2 3 4 5 6; do
    kill -0 "-$STACK_PGID" 2>/dev/null || break
    sleep 0.3
  done
  kill -KILL "-$STACK_PGID" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM EXIT

log "Starting all components..."
setsid npx concurrently -k \
  -n "shared,mcp-tsc,mcp,agent-tsc,agent,ui" \
  -c "blue,green,greenBright,magenta,magentaBright,cyan" \
  "npm run dev -w @re-cinq/lore-shared" \
  "npm run dev -w @re-cinq/lore-mcp" \
  "PORT=3001 npm run start:watch -w @re-cinq/lore-mcp" \
  "npm run dev -w @re-cinq/lore-agent" \
  "npm run start:watch -w @re-cinq/lore-agent" \
  "npm --prefix web-ui run dev" &
STACK_PGID=$!
wait "$STACK_PGID"
