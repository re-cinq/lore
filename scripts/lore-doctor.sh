#!/usr/bin/env bash
# lore-doctor — health check for the Lore platform installation
# Run standalone or as part of install.sh

PASS=0
FAIL=0

check() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then
    printf '  \xe2\x9c\x93  %s\n' "$label"
    PASS=$((PASS + 1))
  else
    printf '  \xe2\x9c\x97  %s\n' "$label"
    FAIL=$((FAIL + 1))
    return 1
  fi
}

LORE_DIR="$HOME/.re-cinq/lore"

echo "[lore] Running diagnostics..."
echo ""

# 1. MCP server entry point
check "MCP server built" \
  test -f "$LORE_DIR/mcp-server/dist/index.js" || \
  echo "     Fix: cd $LORE_DIR/mcp-server && npm install && npm run build"

# 2. specify CLI (optional — warn but don't count as failure)
if command -v specify >/dev/null 2>&1; then
  printf '  \xe2\x9c\x93  %s\n' "specify CLI installed"
  PASS=$((PASS + 1))
else
  printf '  \xe2\x97\x8b  %s\n' "specify CLI not installed (optional)"
  echo "     Install: pipx install specify-cli  OR  uv tool install specify-cli"
fi

# 4. Git connectivity (test SSH — GitHub returns exit 1 but prints "successfully" on success)
git_ssh_ok() {
  timeout 5 ssh -T git@github.com 2>&1 | grep -qi "successfully" 2>/dev/null
}
check "Git can reach github.com (SSH)" \
  git_ssh_ok || \
  echo "     Fix: check SSH key config (ssh -T git@github.com)"

# 5. Platform hooks
check "Platform hooks installed" \
  grep -q "re-cinq/lore" "$HOME/.claude/settings.json" 2>/dev/null || \
  echo "     Fix: node $LORE_DIR/scripts/lore-merge-settings.js"

# 6. Platform skills
check_skills() {
  [ -f "$HOME/.claude/skills/lore-feature/SKILL.md" ] && \
  [ -f "$HOME/.claude/skills/lore-pr/SKILL.md" ]
}
check "Platform skills installed (/lore-feature, /lore-pr)" \
  check_skills || \
  echo "     Fix: cp -r $LORE_DIR/.claude/skills/* ~/.claude/skills/"

# 7. Agent ID
check "Agent ID configured" \
  test -f "$HOME/.lore/agent-id" || \
  echo "     Fix: run install.sh or: mkdir -p ~/.lore && uuidgen > ~/.lore/agent-id"

echo ""
echo "[lore] Results: $PASS passed, $FAIL failed"

# 8. Task delegation (proxy to GKE)
LORE_API_URL="$(git config --global lore.api-url 2>/dev/null || true)"
LORE_TOKEN="$(git config --global lore.ingest-token 2>/dev/null || true)"
if [ -n "$LORE_API_URL" ] && [ -n "$LORE_TOKEN" ]; then
  printf '  \xe2\x9c\x93  %s\n' "Task delegation configured ($LORE_API_URL)"
  PASS=$((PASS + 1))
else
  printf '  \xe2\x97\x8b  %s\n' "Task delegation not configured (optional)"
  echo "     Set: git config --global lore.ingest-token <token>"
  echo "     Set: git config --global lore.api-url https://LORE_API_DOMAIN"
fi

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
