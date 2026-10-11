#!/usr/bin/env bash
set -euo pipefail

# --- Error handling -----------------------------------------------------------
CURRENT_STEP="initialisation"

cleanup_on_error() {
  echo ""
  echo "[lore] Installation failed at step: $CURRENT_STEP"
  echo "[lore] Please fix the issue above and re-run the installer."
  exit 1
}
trap cleanup_on_error ERR

require_cmd() {
  local cmd="$1"
  local hint="${2:-}"
  if ! command -v "$cmd" &>/dev/null; then
    echo "[lore] Error: '$cmd' is required but not found."
    [ -n "$hint" ] && echo "  Hint: $hint"
    return 1
  fi
}

# --- Pre-flight checks -------------------------------------------------------
CURRENT_STEP="pre-flight checks"
require_cmd git "Install git from https://git-scm.com"
require_cmd node "Install Node.js >= 22 from https://nodejs.org"
require_cmd npm "npm ships with Node.js – check your Node.js installation"

# The MCP server is compiled for ES2023 and package.json requires Node >= 22; an older Node would start and then crash on the first ES2023 method.
require_node_major() {
  local min="$1"
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$major" -lt "$min" ]; then
    echo "[lore] Error: Node.js >= $min is required, found $(node -v)."
    echo "  Hint: install Node.js $min or newer from https://nodejs.org"
    return 1
  fi
}
require_node_major 22

LORE_DIR="$HOME/.re-cinq/lore"
LORE_REPO_URL="${LORE_REPO_URL:-git@github.com:re-cinq/lore.git}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- 1. Install context directory --------------------------------------------
install_context() {
  CURRENT_STEP="install context directory"
  if [ ! -d "$LORE_DIR" ]; then
    echo "[lore] Installing to $LORE_DIR ..."
    mkdir -p "$(dirname "$LORE_DIR")"
    # Clone source: the local checkout's origin when run from a clone, else the
    # canonical URL so the installer also works standalone (curl | bash).
    clone_src="$(git -C "$REPO_DIR" remote get-url origin 2>/dev/null || true)"
    [ -z "$clone_src" ] && clone_src="$LORE_REPO_URL"
    git clone --depth 1 "$clone_src" "$LORE_DIR" 2>/dev/null || cp -r "$REPO_DIR" "$LORE_DIR"
  else
    echo "[lore] Updating ..."
    git -c http.timeout=10 -C "$LORE_DIR" pull --quiet --ff-only 2>/dev/null || true
  fi
}

# --- 2. Build MCP server -----------------------------------------------------
build_mcp_server() {
  CURRENT_STEP="build MCP server"
  # Monorepo (npm workspaces): one install at the repo root wires up every
  # workspace. @re-cinq/lore-mcp (the local stdio adapter) needs
  # @re-cinq/lore-shared + @re-cinq/lore-server-core built first.
  cd "$LORE_DIR"
  if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ] 2>/dev/null; then
    echo "[lore] Installing workspace dependencies ..."
    # --ignore-scripts: never run dependency lifecycle scripts during install/update
    # (the #1062 supply-chain vector). Lore's own workspaces build via the explicit
    # `npm run build` below, which --ignore-scripts does not affect.
    npm ci --ignore-scripts --silent 2>&1 || npm install --ignore-scripts --silent 2>&1 || { echo "[lore] Error: npm install failed. Try: cd $LORE_DIR && npm ci --ignore-scripts"; return 1; }
  fi
  echo "[lore] Building shared + server-core + MCP adapter ..."
  npm run build -w @re-cinq/lore-shared -w @re-cinq/lore-server-core -w @re-cinq/lore-mcp 2>&1 || { echo "[lore] Error: build failed."; return 1; }
  # Stamp the built SHA so the MCP self-update check (the lore_update tool /
  # lore-update.sh) can tell when the running adapter is behind origin/main.
  # Without this, a fresh install has no marker and the check falls back to the
  # checkout HEAD — which advances on the SessionStart pull and masks the drift.
  # See specs/mcp-self-update/spec.md.
  mkdir -p "$HOME/.lore"
  git rev-parse HEAD > "$HOME/.lore/mcp-build-head" 2>/dev/null || true
  cd - >/dev/null
}

# --- 3. Detect team -----------------------------------------------------------
select_team() {
  CURRENT_STEP="detect team"
  TEAM="$(git config --global lore.team 2>/dev/null || true)"
  if [ -z "$TEAM" ]; then
    TEAM="platform"
    git config --global lore.team "$TEAM"
  fi
}

# --- 4. Register MCP server + merge settings ---------------------------------
merge_settings() {
  CURRENT_STEP="merge Claude settings"
  echo "[lore] Configuring MCP server + hooks for team '$TEAM' ..."

  if ! command -v claude &>/dev/null; then
    echo "[lore] Error: 'claude' is required to register the MCP server but was not found."
    echo "  Hint: install Claude Code from https://claude.com/claude-code, then re-run this installer"
    return 1
  fi

  LORE_API_URL="${LORE_API_URL:-$(git config --global lore.api-url 2>/dev/null || true)}"
  LORE_TOKEN="${LORE_INGEST_TOKEN:-$(git config --global lore.ingest-token 2>/dev/null || true)}"

  if [ -z "$LORE_API_URL" ]; then
    echo ""
    echo "[lore] The Lore API URL is required, e.g. https://lore-api.example.com"
    echo "  Ask the platform team, or re-run with LORE_API_URL=<url> set."
    if [ -r /dev/tty ]; then
      read -r -p "[lore] Lore API URL: " LORE_API_URL < /dev/tty || LORE_API_URL=""
    fi
  fi
  if [ -z "$LORE_API_URL" ]; then
    echo "[lore] Error: no Lore API URL. Re-run with LORE_API_URL=<url> set."
    return 1
  fi

  if [ -z "$LORE_TOKEN" ]; then
    echo ""
    echo "[lore] A Lore API token is required."
    echo "  Get it from: kubectl get secret lore-ingest-token -n lore-api -o jsonpath='{.data.token}' | base64 -d"
    echo "  Or ask the platform team."
    echo ""
    if [ -r /dev/tty ]; then
      read -r -p "[lore] Paste token: " LORE_TOKEN < /dev/tty || LORE_TOKEN=""
    fi
  fi
  if [ -z "$LORE_TOKEN" ]; then
    echo "[lore] Error: no Lore API token. Re-run with LORE_INGEST_TOKEN=<token> set."
    return 1
  fi

  git config --global lore.api-url "$LORE_API_URL"
  git config --global lore.ingest-token "$LORE_TOKEN"

  claude mcp remove -s local lore-context >/dev/null 2>&1 || true
  claude mcp remove -s user lore-context >/dev/null 2>&1 || true

  if claude mcp add -s user \
    -e "CONTEXT_PATH=$LORE_DIR" \
    -e "LORE_API_URL=$LORE_API_URL" \
    -e "LORE_INGEST_TOKEN=$LORE_TOKEN" \
    lore-context -- node "$LORE_DIR/apps/mcp-server/dist/index.js" >/dev/null 2>&1; then
    echo "[lore] MCP server registered for every repo (user scope)"
  else
    echo "[lore] Error: 'claude mcp add -s user lore-context' failed, so Lore is not registered anywhere."
    echo "  Hint: run 'claude mcp list' to inspect, then re-run this installer"
    return 1
  fi

  # Merge env vars + hooks + status line into settings.json
  node "$LORE_DIR/scripts/lore-merge-settings.js" "$TEAM"
}

# --- 5. Install platform skills -----------------------------------------------
install_skills() {
  CURRENT_STEP="install platform skills"
  echo "[lore] Installing platform skills ..."
  mkdir -p "$HOME/.claude/skills"
  # These are Lore-owned vendored files, so an existing copy is refreshed rather
  # than skipped: skipping meant a skill edited upstream never reached a machine
  # that had installed once, and /lore-help then documented behaviour the
  # installed copy did not have. A hand-edited copy is overwritten — the
  # "Updated" line says so.
  for skill_dir in "$LORE_DIR/.claude/skills/"*/; do
    [ -d "$skill_dir" ] || continue
    name="$(basename "$skill_dir")"
    dest="$HOME/.claude/skills/$name"
    if [ ! -d "$dest" ]; then
      cp -r "$skill_dir" "$dest"
      echo "  Installed /$name"
    elif diff -rq "$skill_dir" "$dest" >/dev/null 2>&1; then
      echo "  Up to date /$name"
    else
      cp -r "$skill_dir/." "$dest/"
      echo "  Updated /$name"
    fi
  done
}

# --- 6. Ensure specify is installed -------------------------------------------
install_specify() {
  CURRENT_STEP="install specify CLI"
  if ! command -v specify >/dev/null 2>&1; then
    echo "[lore] Installing specify-cli ..."
    pipx install specify-cli 2>/dev/null || \
      uv tool install specify-cli 2>/dev/null || \
      pip install --user specify-cli 2>/dev/null || \
      echo "[lore] Warning: could not install specify-cli (try: pipx install specify-cli)"
  else
    echo "[lore] specify CLI already installed"
  fi
}

# --- 7. Generate agent ID ---
generate_agent_id() {
  CURRENT_STEP="generate agent ID"
  AGENT_ID_FILE="$HOME/.lore/agent-id"
  mkdir -p "$HOME/.lore"
  if [ ! -f "$AGENT_ID_FILE" ]; then
    uuidgen > "$AGENT_ID_FILE" 2>/dev/null || python3 -c "import uuid; print(uuid.uuid4())" > "$AGENT_ID_FILE"
    echo "[lore] Agent ID generated: $(cat "$AGENT_ID_FILE")"
  else
    echo "[lore] Agent ID exists: $(cat "$AGENT_ID_FILE")"
  fi
}

# --- 8. Optional: AgentDB local cache ----------------------------------------
install_agentdb() {
  CURRENT_STEP="AgentDB local cache"
  # Auto-install if npm is available — no prompt needed
  if command -v npx &>/dev/null && ! command -v agentdb &>/dev/null; then
    npm install -g agentdb --ignore-scripts --silent 2>/dev/null || true
  fi
}

# --- Run all steps ------------------------------------------------------------
install_context
build_mcp_server
select_team
merge_settings
install_skills
install_specify
generate_agent_id
install_agentdb

# --- 10. Run diagnostics -----------------------------------------------------
CURRENT_STEP="run diagnostics"
echo ""
"$LORE_DIR/scripts/lore-doctor.sh" || true

echo ""
echo "[lore] Installation complete."
