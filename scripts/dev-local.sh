#!/usr/bin/env bash
set -euo pipefail

# Boot the full Lore stack locally with live reload:
#   Postgres (docker) + shared (tsc --watch) + mcp-server + agent + web-ui.
# Idempotent — safe to re-run. Ctrl-C tears everything down (concurrently -k).
#
# Ports after start: web-ui :3000, mcp-server :3001, skills :3002, event-router :3003,
# stations :3004, cluster-agent :3005, agent :8080, Postgres :5432.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { echo "[lore] $*"; }
fail() { echo "[lore] ERROR: $*" >&2; exit 1; }

# Kill any stale Lore stack from a previous `npm start`. node --watch children
# ignore plain SIGTERM and can survive a rough exit, then hold the service ports
# (web-ui :3000, mcp-server :3001, skills :3002, event-router :3003, stations :3004,
# cluster-agent :3005, agent :8080) so the next run dies
# with EADDRINUSE. Free those ports here. Postgres :5432 / Dgraph :8081 are
# docker-managed, so we leave them alone. Idempotent: a no-op when nothing runs.
free_stale_ports() {
  command -v lsof >/dev/null 2>&1 || { log "lsof not found — skipping stale-instance cleanup"; return 0; }
  local port pids
  for port in 3000 3001 3002 3003 3004 3005 8080; do
    pids="$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true)"
    [ -n "$pids" ] || continue
    log "Port $port held by a stale instance (PID $(echo "$pids" | tr '\n' ' ')) — stopping it"
    kill -TERM $pids 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      pids="$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true)"
      [ -n "$pids" ] || break
      sleep 0.3
    done
    [ -n "$pids" ] && kill -KILL $pids 2>/dev/null || true
  done
}

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
docker compose -f "$ROOT/infra/compose.yaml" up -d --wait \
  || fail "backing services did not become healthy — check 'docker compose logs'"
log "Postgres ready on localhost:5432 (db=lore user=postgres password=lore); Dgraph ready on localhost:9080 (gRPC) / :8081 (HTTP)"

# 1b. Apply schema DDL — Postgres (CREATE ... IF NOT EXISTS) + Dgraph DQL
#     (/alter). Both idempotent.
bash "$ROOT/scripts/infra/setup-local-schema.sh"
DGRAPH_HTTP="http://localhost:8081" bash "$ROOT/scripts/infra/setup-memory-dgraph-schema.sh"
DGRAPH_HTTP="http://localhost:8081" bash "$ROOT/scripts/infra/setup-spec-trace-schema.sh"

# 2. Local DB env defaults — propagate to every child process below.
export LORE_DB_HOST=localhost
export LORE_DB_PORT=5432
export LORE_DB_NAME=lore
export LORE_DB_USER=postgres
export LORE_DB_PASSWORD=lore
# Spec-traceability graph: lets mcp-server's project.trace + the ingest-* tasks
# read/write the local Dgraph (published on :8081 by docker compose).
export LORE_DGRAPH_HTTP="${LORE_DGRAPH_HTTP:-http://localhost:8081}"

# 2a. Internal API token shared by the web-ui ↔ mcp-server proxy routes.
#     The web-ui proxies /api/pipeline/.../timeline and /api/repos/.../context-preview
#     to the mcp-server; both sides must present the SAME LORE_INGEST_TOKEN, which
#     the mcp-server accepts via its legacy full-access path. Without this the
#     proxy routes return "LORE_API_URL/LORE_INGEST_TOKEN not configured".
#     A fixed localhost-only token keeps the backend (here) and the Next.js
#     web-ui (apps/web-ui/.env.local) in sync without a generation/copy step; both
#     honour any pre-set value so you can override for a real backend.
export LORE_API_URL="${LORE_API_URL:-http://localhost:3001}"
export LORE_INGEST_TOKEN="${LORE_INGEST_TOKEN:-lore-local-dev-token}"

# 2b. The Floor's own HTTP server (:8080, PORT below). The web-ui proxies the run
#     visualization's event history and SSE stream through it
#     (/api/assembly-lines/[id]/events{,/stream}); unset, those routes answer
#     "not configured" and every live run graph sits permanently Offline.
export LORE_FLOOR_URL="${LORE_FLOOR_URL:-http://localhost:8080}"

# 2c. lore-api's own Floor URL: the /api/task-turns relay (issue #1295) forwards
#     locally-run task transcripts to the Floor's /api/agent-events sink through
#     it. Unset, the relay answers 503 and local-run transcripts stay on disk.
export LORE_AGENT_URL="${LORE_AGENT_URL:-http://localhost:8080}"

# 2d. The three service deployables the Floor talks to over HTTP (ADR-044 /
#     ADR-024). Running them locally is not a nicety: on 2026-08-24 the Floor
#     shipped sending LORE_INGEST_TOKEN while all three charts mounted
#     LORE_AGENT_INTERNAL_TOKEN, and every call 401'd in production. Each end was
#     correct alone; only the pair was wrong, and nothing local exercised the
#     pair. It does now.
#
#     Both ends read LORE_AGENT_INTERNAL_TOKEN here, defaulting to the same
#     LORE_INGEST_TOKEN above so a local run needs one token, not two.
export LORE_AGENT_INTERNAL_TOKEN="${LORE_AGENT_INTERNAL_TOKEN:-$LORE_INGEST_TOKEN}"
export EVENT_ROUTER_URL="${EVENT_ROUTER_URL:-http://localhost:3003}"
export STATIONS_URL="${STATIONS_URL:-http://localhost:3004}"
export CLUSTER_AGENT_URL="${CLUSTER_AGENT_URL:-http://localhost:3005}"

#     The cluster-agent registers and claims like every other one — there is no
#     unregistered mode — so both ends of the registration need the same
#     pre-shared token locally. lore-api reads it to authorize
#     POST /api/cluster-agents/register; the agent presents it once at boot and
#     uses the per-agent token it gets back for everything after.
export LORE_CLUSTER_AGENT_REGISTRATION_TOKEN="${LORE_CLUSTER_AGENT_REGISTRATION_TOKEN:-lore-local-registration-token}"
export LORE_CLUSTER_AGENT_NAME="${LORE_CLUSTER_AGENT_NAME:-central}"
#     Every tag, as the umbrella chart's central agent carries: on a laptop this
#     is the only cluster, so anything it cannot claim runs nowhere.
export LORE_CLUSTER_AGENT_TAGS="${LORE_CLUSTER_AGENT_TAGS:-node:agent,node:validate,node:gate,node:retrospective,node:github_action,node:detect,node:ingest,node:comment-triage}"

# Station execution. Tasks run as Agent CRs on the ai-agent-subsystem (agent-cr),
# which needs a Kubernetes cluster. The default `inprocess` keeps the lightweight
# feature-planning/finalize path for a dev without one; set LORE_STATION_BACKEND=k8s
# in .env.local to execute real impl/review tasks against a laptop minikube.
export LORE_STATION_BACKEND="${LORE_STATION_BACKEND:-inprocess}"

# Agent CR plumbing. The Floor reaches the cluster through the developer's kubeconfig
# (LORE_KUBECONFIG, else KUBECONFIG, else ~/.kube/config — shared/src/kube-config.ts);
# run pods reach back to this host at host.minikube.internal. The run pods' telemetry
# callbacks are authorized with LORE_AGENT_INTERNAL_TOKEN, so this host and the
# cluster's agent-secrets must agree — both default to the same dev token.
export LORE_AGENTS_NAMESPACE="${LORE_AGENTS_NAMESPACE:-ai-agents}"
export LORE_AGENT_INTERNAL_TOKEN="${LORE_AGENT_INTERNAL_TOKEN:-lore-local-agent-token}"

# Agent conversations (ai-agent-subsystem#188): a run saves its state so a LATER run
# continues it instead of being re-briefed. Two things have to be true or the whole
# path degrades silently — by design, but silently.
#
#  * The pod fetches and posts the archive itself, so it needs the URL as the POD
#    sees this host, not as this host sees itself.
#  * The bytes need somewhere to live. Deployed that is a GCS bucket; here it is a
#    directory, opt-in via LORE_ARCHIVE_DIR (a cluster that lost its bucket config
#    must NOT silently fall back to pod-local disk that vanishes with the pod).
#
# Without them a round still succeeds and simply never continues anything, which is
# indistinguishable from continuity that remembered nothing.
export LORE_FLOOR_POD_URL="${LORE_FLOOR_POD_URL:-http://host.minikube.internal:8080}"
export LORE_ARCHIVE_DIR="${LORE_ARCHIVE_DIR:-$ROOT/.lore-archive}"

if [ "$LORE_STATION_BACKEND" = "k8s" ]; then
  log "Station backend is k8s — bootstrapping the ai-agent-subsystem on minikube"
  bash "$ROOT/scripts/infra/setup-minikube-agents.sh"
  # The setup script wrote a kubeconfig holding ONLY the minikube context. Point the
  # Floor at it so its Agent CR dispatch cannot follow a stray current-context into a
  # real cluster; an explicitly-set LORE_KUBECONFIG still wins.
  export LORE_KUBECONFIG="${LORE_KUBECONFIG:-$ROOT/.lore-kubeconfig-minikube}"
fi

# 2b. web-ui auth (NextAuth). Needs a URL + secret locally. Generate the secret
#     once and persist it (gitignored) so sessions survive restarts.
export NEXTAUTH_URL="http://localhost:3000"
SECRET_FILE="$ROOT/.lore-nextauth-secret"
if [ ! -s "$SECRET_FILE" ]; then
  (openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64) > "$SECRET_FILE"
fi
export NEXTAUTH_SECRET="$(cat "$SECRET_FILE")"

# web-ui login uses GitHub OAuth (apps/web-ui/src/lib/auth-options.ts). The creds
# live in apps/web-ui/.env.local, which `next dev` loads directly — so check there,
# not just the shell env, to avoid a false alarm once they're set.
if ! grep -qE '^GITHUB_OAUTH_CLIENT_ID=.+' "$ROOT/apps/web-ui/.env.local" 2>/dev/null \
   && [ -z "${GITHUB_OAUTH_CLIENT_ID:-}" ]; then
  log "GitHub OAuth not configured — web-ui login will fail until you set it up:"
  log "  1. Create an OAuth app: https://github.com/settings/developers (New OAuth App)"
  log "     Homepage http://localhost:3000  ·  Callback http://localhost:3000/api/auth/callback/github"
  log "  2. Put GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET in apps/web-ui/.env.local, then restart."
fi

# 3. web-ui deps live outside the workspace — install on first run.
if [ ! -d "$ROOT/apps/web-ui/node_modules" ]; then
  log "Installing web-ui dependencies (first run)..."
  npm --prefix apps/web-ui install
fi

# 4. Build once so 'node --watch dist/index.js' has something to run cold.
#    Order matters: floor imports @re-cinq/lore-runner and mcp imports
#    @re-cinq/lore-shared, so dependencies must be built first. The root
#    `build` script encodes the canonical order (shared -> runner -> mcp -> floor).
log "Building shared, runner, server-core, lore-api, mcp-server, agent..."
npm run build

# 5. Run everything with live reload — one slot per process so -k kills all.
#    Each TS service gets a tsc --watch (recompile) + node --watch (restart) PAIR.
#    Both halves, always: node --watch watches ./dist, so a service given only the
#    restart half watches a directory nothing recompiles and an edit to its source
#    changes nothing until the next manual build.
#    start:watch watches both ./dist and ../shared/dist, so a shared-package edit
#    recompiles (shared tsc) and restarts the dependent services too.
#
#    Teardown: concurrently runs in its OWN process group, created via bash
#    job-control (set -m) so it works on macOS too (which has no setsid). Ctrl-C
#    reaches only this script, whose trap signals the whole group — node --watch
#    children ignore plain SIGTERM, so we escalate to SIGKILL. This guarantees a
#    clean stop with no orphaned watchers.
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

free_stale_ports

log "Starting all components..."
# set -m puts the backgrounded stack in its own process group (PGID == PID) on
# both macOS and Linux — a portable stand-in for `setsid`.
set -m
# The :3001 HTTP backend is now apps/lore-api (the remote REST API). The local
# stdio MCP adapter (apps/mcp-server) is not run as a daemon here — Claude Code
# spawns it on demand — but its tsc --watch keeps dist/ fresh for that use.
#
# The `skills` entry runs that same adapter in HTTP-gateway mode purely to serve
# the /skills registry on :3002. A run pod's init fetches its skills AND its
# $HOME/.claude/settings.json from there; without it the agent container starts and
# dies with "Settings file not found", which is invisible from the Floor side.
# LORE_AGENT_SKILLS_DIR is explicit because the gateway otherwise resolves the
# bundle relative to cwd, and concurrently runs from the repo root.
names="shared,core,api-tsc,api,mcp-tsc,skills,agent-tsc,agent,router-tsc,router,stations-tsc,stations"
colors="blue,gray,green,greenBright,yellow,white,magenta,magentaBright,red,red,redBright,redBright"
commands=(
  "npm run dev -w @re-cinq/lore-shared"
  "npm run dev -w @re-cinq/lore-server-core"
  "npm run dev -w @re-cinq/lore-api"
  "PORT=3001 npm run start:watch -w @re-cinq/lore-api"
  "npm run dev -w @re-cinq/lore-mcp"
  "LORE_MCP_HTTP=1 LORE_MCP_PORT=3002 LORE_AGENT_SKILLS_DIR=$ROOT/apps/mcp-server/agent-skills npm run start -w @re-cinq/lore-mcp"
  "npm run dev -w @re-cinq/lore-floor"
  "npm run start:watch -w @re-cinq/lore-floor"
  "npm run dev -w @re-cinq/lore-event-router"
  "PORT=3003 npm run start:watch -w @re-cinq/lore-event-router"
  "npm run dev -w @re-cinq/lore-stations"
  "PORT=3004 npm run start:watch -w @re-cinq/lore-stations"
)

# The cluster-agent runs only with a cluster to run against. It is a Kubernetes
# client and a claim loop and nothing else, so without `k8s` it now refuses to
# boot — and under `concurrently -k` one exiting process takes the whole stack
# with it. Skipping it keeps `LORE_STATION_BACKEND=inprocess` (the default, for a
# dev with no minikube) a working stack rather than an immediate teardown.
if [ "$LORE_STATION_BACKEND" = "k8s" ]; then
  names="$names,cluster-tsc,cluster"
  colors="$colors,yellowBright,yellowBright"
  commands+=(
    "npm run dev -w @re-cinq/lore-cluster-agent"
    "PORT=3005 npm run start:watch -w @re-cinq/lore-cluster-agent"
  )
else
  log "LORE_STATION_BACKEND=$LORE_STATION_BACKEND — cluster-agent not started (it needs a cluster to claim into)"
fi
names="$names,ui"
colors="$colors,cyan"
commands+=("npm --prefix apps/web-ui run dev")

npx concurrently -k -n "$names" -c "$colors" "${commands[@]}" &
STACK_PGID=$!
set +m
wait "$STACK_PGID"
