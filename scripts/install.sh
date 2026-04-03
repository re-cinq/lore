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
require_cmd node "Install Node.js >= 18 from https://nodejs.org"
require_cmd npm "npm ships with Node.js – check your Node.js installation"

LORE_DIR="$HOME/.re-cinq/lore"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- 1. Install context directory --------------------------------------------
install_context() {
  CURRENT_STEP="install context directory"
  if [ ! -d "$LORE_DIR" ]; then
    echo "[lore] Installing to $LORE_DIR ..."
    mkdir -p "$(dirname "$LORE_DIR")"
    git clone --depth 1 "$(git -C "$REPO_DIR" remote get-url origin 2>/dev/null || echo "$REPO_DIR")" "$LORE_DIR" 2>/dev/null || cp -r "$REPO_DIR" "$LORE_DIR"
  else
    echo "[lore] Updating ..."
    git -c http.timeout=10 -C "$LORE_DIR" pull --quiet --ff-only 2>/dev/null || true
  fi
}

# --- 2. Build MCP server -----------------------------------------------------
build_mcp_server() {
  CURRENT_STEP="build MCP server"
  echo "[lore] Building MCP server ..."
  cd "$LORE_DIR/mcp-server"
  # Only reinstall if node_modules is missing or package-lock changed
  if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ] 2>/dev/null; then
    rm -rf node_modules
    npm ci --silent 2>&1 || { echo "[lore] Error: npm ci failed. Try: cd $LORE_DIR/mcp-server && npm install"; return 1; }
  fi
  npm run build 2>&1 || { echo "[lore] Error: build failed."; return 1; }
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

  # Register MCP server via CLI (the reliable way)
  if command -v claude &>/dev/null; then
    claude mcp remove lore-context 2>/dev/null || true

    # Read API URL and token from config (set during first install or manually)
    LORE_API_URL="$(git config --global lore.api-url 2>/dev/null || true)"
    LORE_TOKEN="$(git config --global lore.ingest-token 2>/dev/null || true)"

    # Set default API URL if not configured
    if [ -z "$LORE_API_URL" ]; then
      LORE_API_URL="${LORE_API_URL:-}"
      git config --global lore.api-url "$LORE_API_URL"
    fi

    # Prompt for token if not set
    if [ -z "$LORE_TOKEN" ]; then
      echo ""
      echo "[lore] To delegate tasks from Claude Code to agents, you need a token."
      echo "  Get it from: kubectl get secret lore-ingest-token -n mcp-servers -o jsonpath='{.data.token}' | base64 -d"
      echo "  Or ask the platform team."
      echo ""
      read -r -p "[lore] Paste token (or Enter to skip — you can set it later): " LORE_TOKEN
      if [ -n "$LORE_TOKEN" ]; then
        git config --global lore.ingest-token "$LORE_TOKEN"
        echo "[lore] Token saved."
      else
        echo "[lore] Skipped. Set later: git config --global lore.ingest-token <token>"
      fi
    fi

    MCP_ENV_ARGS=(-e "CONTEXT_PATH=$LORE_DIR" -e "LORE_TEAM=$TEAM")
    if [ -n "$LORE_API_URL" ]; then
      MCP_ENV_ARGS+=(-e "LORE_API_URL=$LORE_API_URL")
    fi
    if [ -n "$LORE_TOKEN" ]; then
      MCP_ENV_ARGS+=(-e "LORE_INGEST_TOKEN=$LORE_TOKEN")
    fi

    claude mcp add lore-context node \
      "$LORE_DIR/mcp-server/dist/index.js" \
      "${MCP_ENV_ARGS[@]}" \
      2>/dev/null && echo "[lore] MCP server registered via claude CLI" || \
      echo "[lore] Warning: claude mcp add failed, falling back to settings.json"
  fi

  # Merge env vars + hooks + status line into settings.json
  node "$LORE_DIR/scripts/lore-merge-settings.js" "$TEAM"
}

# --- 5. Install platform skills -----------------------------------------------
install_skills() {
  CURRENT_STEP="install platform skills"
  echo "[lore] Installing platform skills ..."
  mkdir -p "$HOME/.claude/skills"
  for skill_dir in "$LORE_DIR/.claude/skills/"*/; do
    [ -d "$skill_dir" ] || continue
    name="$(basename "$skill_dir")"
    dest="$HOME/.claude/skills/$name"
    if [ ! -d "$dest" ]; then
      cp -r "$skill_dir" "$dest"
      echo "  Installed /$(basename "$skill_dir")"
    else
      echo "  Skipped /$(basename "$skill_dir") (already exists)"
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
    npm install -g agentdb --silent 2>/dev/null || true
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
