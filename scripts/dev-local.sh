#!/usr/bin/env bash
set -euo pipefail

# Boot the full Lore stack locally with live reload:
#   Postgres (docker) + shared (tsc --watch) + mcp-server + agent + web-ui.
# Idempotent — safe to re-run. Ctrl-C tears everything down (concurrently -k).
#
# Ports after start: web-ui :3000, mcp-server :3001, agent :8080, Postgres :5432.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { echo "[lore] $*"; }
fail() { echo "[lore] ERROR: $*" >&2; exit 1; }

# Load local secrets/overrides (gitignored). Put GitHub OAuth creds here so they
# don't have to be re-exported every session. See .env.local.example.
if [ -f "$ROOT/.env.local" ]; then
  log "Loading .env.local"
  set -a; . "$ROOT/.env.local"; set +a
fi

command -v docker >/dev/null 2>&1 || fail "docker not found — needed for local Postgres + Dgraph"
docker compose version >/dev/null 2>&1 || fail "docker compose v2 not found — needed for the local services"

# 1. Bring up the backing services (Postgres + Dgraph) from compose.yaml and wait
#    for their healthchecks. compose.yaml is the single source of truth for the
#    local DBs (same container names + bind-mounted, git-ignored .lore-*data dirs
#    as the standalone `npm run db:up`/`dgraph:up` scripts), so data persists
#    across restarts. Idempotent: re-running starts/recreates only what's needed.
#    Dgraph HTTP is published on :8081 (host) to avoid the agent's :8080.
log "Bringing up backing services (Postgres + Dgraph) via docker compose..."
docker compose -f "$ROOT/compose.yaml" up -d --wait \
  || fail "backing services did not become healthy — check 'docker compose logs'"
log "Postgres ready on localhost:5432 (db=lore user=postgres password=lore); Dgraph ready on localhost:9080 (gRPC) / :8081 (HTTP)"

# 1b. Apply schema DDL (idempotent — CREATE ... IF NOT EXISTS).
bash "$ROOT/scripts/infra/setup-local-schema.sh"

# 2. Local DB env defaults — propagate to every child process below.
export LORE_DB_HOST=localhost
export LORE_DB_PORT=5432
export LORE_DB_NAME=lore
export LORE_DB_USER=postgres
export LORE_DB_PASSWORD=lore

# 2a. Internal API token shared by the web-ui ↔ mcp-server proxy routes.
#     The web-ui proxies /api/pipeline/.../timeline and /api/repos/.../context-preview
#     to the mcp-server; both sides must present the SAME LORE_INGEST_TOKEN, which
#     the mcp-server accepts via its legacy full-access path. Without this the
#     proxy routes return "LORE_API_URL/LORE_INGEST_TOKEN not configured".
#     A fixed localhost-only token keeps the backend (here) and the Next.js
#     web-ui (web-ui/.env.local) in sync without a generation/copy step; both
#     honour any pre-set value so you can override for a real backend.
export LORE_API_URL="${LORE_API_URL:-http://localhost:3001}"
export LORE_INGEST_TOKEN="${LORE_INGEST_TOKEN:-lore-local-dev-token}"

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
  "MCP_TRANSPORT=http PORT=3001 npm run start:watch -w @re-cinq/lore-mcp" \
  "npm run dev -w @re-cinq/lore-agent" \
  "npm run start:watch -w @re-cinq/lore-agent" \
  "npm --prefix web-ui run dev" &
STACK_PGID=$!
wait "$STACK_PGID"
