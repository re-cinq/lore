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
    echo "[lore] Installing context to $LORE_DIR ..."
    mkdir -p "$(dirname "$LORE_DIR")"
    cp -r "$REPO_DIR" "$LORE_DIR"
  else
    echo "[lore] Context directory exists, pulling latest ..."
    git -c http.timeout=10 -C "$LORE_DIR" pull --quiet --ff-only 2>/dev/null || true
  fi
}

# --- 2. Build MCP server -----------------------------------------------------
build_mcp_server() {
  CURRENT_STEP="build MCP server"
  echo "[lore] Building MCP server ..."
  if ! (cd "$LORE_DIR/mcp-server" && npm install --silent 2>&1 && npm run build 2>&1); then
    echo "[lore] Error: npm install/build failed in mcp-server."
    echo "  Check that Node.js >= 18 is installed: node --version"
    echo "  Try running manually: cd $LORE_DIR/mcp-server && npm install"
    return 1
  fi
}

# --- 3. Detect / prompt for team ---------------------------------------------
select_team() {
  CURRENT_STEP="detect/prompt for team"
  TEAM="$(git config --global lore.team 2>/dev/null || true)"

  if [ -z "$TEAM" ]; then
    echo ""
    echo "[lore] Available teams:"
    echo "  1) platform"
    echo ""
    read -r -p "[lore] Select your team (1-1): " CHOICE
    case "$CHOICE" in
      1) TEAM="platform" ;;
      *) echo "[lore] Invalid choice, defaulting to 'platform'"; TEAM="platform" ;;
    esac
    git config --global lore.team "$TEAM"
    echo "[lore] Team set to '$TEAM' (stored in git config --global lore.team)"
  fi
}

# --- 4. Register MCP server + merge settings ---------------------------------
merge_settings() {
  CURRENT_STEP="merge Claude settings"
  echo "[lore] Configuring MCP server + hooks for team '$TEAM' ..."

  # Register MCP server via CLI (the reliable way)
  if command -v claude &>/dev/null; then
    claude mcp remove lore-context 2>/dev/null || true
    claude mcp add lore-context node \
      "$LORE_DIR/mcp-server/dist/index.js" \
      -e "CONTEXT_PATH=$LORE_DIR" \
      -e "LORE_TEAM=$TEAM" \
      2>/dev/null && echo "[lore] MCP server registered via claude CLI" || \
      echo "[lore] Warning: claude mcp add failed, falling back to settings.json"
  fi

  # Merge env vars + hooks into settings.json (still needed for hooks and env)
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

# --- 6. Ensure bd is installed ------------------------------------------------
install_bd() {
  CURRENT_STEP="install bd CLI"
  if ! command -v bd >/dev/null 2>&1; then
    echo "[lore] Installing @beads/bd ..."
    if ! command -v npm &>/dev/null; then
      echo "[lore] Warning: npm not found, skipping @beads/bd"
    elif ! npm install -g @beads/bd --silent 2>/dev/null; then
      echo "[lore] Warning: could not install @beads/bd"
      echo "  Try manually: npm install -g @beads/bd"
    fi
  else
    echo "[lore] bd CLI already installed"
  fi
}

# --- 7. Ensure specify is installed -------------------------------------------
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

# --- 8. Initialise beads -----------------------------------------------------
init_beads() {
  CURRENT_STEP="initialise beads"
  if [ ! -d "$LORE_DIR/.beads" ]; then
    echo "[lore] Initialising beads ..."
    if command -v bd &>/dev/null; then
      (cd "$LORE_DIR" && bd init 2>/dev/null) || true
    else
      echo "[lore] Warning: bd not found, skipping beads init"
    fi
  else
    echo "[lore] Beads already initialised"
  fi
}

# --- Generate agent ID ---
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

# --- 9. Optional: AgentDB local cache ----------------------------------------
install_agentdb() {
  CURRENT_STEP="AgentDB local cache (optional)"
  echo ""
  echo -n "[lore] Install AgentDB local cache for sub-ms retrieval? (y/N) "
  read -r USE_AGENTDB
  if [[ "$USE_AGENTDB" == "y" || "$USE_AGENTDB" == "Y" ]]; then
    if command -v npx &>/dev/null; then
      if npm install -g agentdb --silent 2>/dev/null; then
        echo "[lore] AgentDB installed"
      else
        echo "[lore] Warning: could not install agentdb"
        echo "  Try manually: npm install -g agentdb"
      fi
      # Add to claude settings
      node -e "
        const fs = require('fs');
        const p = require('path').join(process.env.HOME, '.claude', 'settings.json');
        const s = JSON.parse(fs.readFileSync(p, 'utf8'));
        s.mcpServers = s.mcpServers || {};
        if (!s.mcpServers['local-cache']) {
          s.mcpServers['local-cache'] = {
            command: 'npx',
            args: ['agentdb', 'mcp', 'start', '--db', process.env.HOME + '/.lore-cache.db']
          };
          fs.writeFileSync(p, JSON.stringify(s, null, 2));
          console.log('[lore] AgentDB MCP server configured');
        }
      "
    else
      echo "[lore] Warning: npx not found, skipping AgentDB"
    fi
  fi
}

# --- Run all steps ------------------------------------------------------------
install_context
build_mcp_server
select_team
merge_settings
install_skills
install_bd
install_specify
init_beads
generate_agent_id
install_agentdb

# --- 10. Run diagnostics -----------------------------------------------------
CURRENT_STEP="run diagnostics"
echo ""
"$LORE_DIR/scripts/lore-doctor.sh" || true

echo ""
echo "[lore] Installation complete."
