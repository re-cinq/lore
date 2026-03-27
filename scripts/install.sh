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
  if ! (cd "$LORE_DIR/mcp-server" && npm install --silent && npm run build) 2>&1 | \
    sed 's/^/  /'; then
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
    echo "  1) payments"
    echo "  2) platform"
    echo "  3) mobile"
    echo "  4) data"
    echo ""
    read -r -p "[lore] Select your team (1-4): " CHOICE
    case "$CHOICE" in
      1) TEAM="payments" ;;
      2) TEAM="platform" ;;
      3) TEAM="mobile" ;;
      4) TEAM="data" ;;
      *) echo "[lore] Invalid choice, defaulting to 'platform'"; TEAM="platform" ;;
    esac
    git config --global lore.team "$TEAM"
    echo "[lore] Team set to '$TEAM' (stored in git config --global lore.team)"
  fi
}

# --- 4. Merge settings -------------------------------------------------------
merge_settings() {
  CURRENT_STEP="merge Claude settings"
  echo "[lore] Merging Claude settings for team '$TEAM' ..."
  node "$LORE_DIR/scripts/lore-merge-settings.js" "$TEAM"
}

# --- 5. Install platform skills -----------------------------------------------
install_skills() {
  CURRENT_STEP="install platform skills"
  echo "[lore] Installing platform skills ..."
  mkdir -p "$HOME/.claude/skills"
  for skill in "$LORE_DIR/.claude/skills/"*.md; do
    [ -f "$skill" ] || continue
    dest="$HOME/.claude/skills/$(basename "$skill")"
    if [ ! -f "$dest" ]; then
      cp "$skill" "$dest"
      echo "  Installed $(basename "$skill")"
    else
      echo "  Skipped $(basename "$skill") (already exists)"
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
install_agentdb

# --- 10. Run diagnostics -----------------------------------------------------
CURRENT_STEP="run diagnostics"
echo ""
"$LORE_DIR/scripts/lore-doctor.sh" || true

echo ""
echo "[lore] Installation complete."
