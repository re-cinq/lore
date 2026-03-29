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

# 2. bd CLI
check "bd CLI installed" \
  command -v bd || \
  echo "     Fix: npm install -g @beads/bd"

# 3. specify CLI (optional — warn but don't count as failure)
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

# Phase 1+ checks (optional — do not affect exit code)
echo ""
echo "Phase 1+ (optional):"

echo -n "  PostgreSQL: "
if [ -n "${LORE_DB_HOST:-}" ]; then
  if pg_isready -h "$LORE_DB_HOST" -p 5432 -t 3 &>/dev/null; then
    echo "reachable"
  else
    echo "unreachable at $LORE_DB_HOST"
  fi
else
  echo "- not configured (LORE_DB_HOST not set)"
fi

echo -n "  MCP HTTP endpoint: "
if [ -n "${LORE_MCP_ENDPOINT:-}" ]; then
  if curl -sf --max-time 3 "$LORE_MCP_ENDPOINT/mcp" -X POST -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' -H 'Content-Type: application/json' &>/dev/null; then
    echo "reachable"
  else
    echo "unreachable at $LORE_MCP_ENDPOINT"
  fi
else
  echo "- not configured (LORE_MCP_ENDPOINT not set)"
fi

echo -n "  Klaus: "
if [ -n "${LORE_KLAUS_ENDPOINT:-}" ]; then
  if curl -sf --max-time 3 "$LORE_KLAUS_ENDPOINT/health" &>/dev/null; then
    echo "reachable"
  else
    echo "unreachable at $LORE_KLAUS_ENDPOINT"
  fi
else
  echo "- not configured (LORE_KLAUS_ENDPOINT not set)"
fi

echo -n "  Dolt remote: "
if command -v bd &>/dev/null && bd remote -v 2>/dev/null | grep -q origin; then
  echo "configured"
else
  echo "- not configured"
fi

echo -n "  Scheduled jobs: "
if kubectl get cronjobs -n klaus 2>/dev/null | grep -q lore-; then
  echo "configured ($(kubectl get cronjobs -n klaus --no-headers 2>/dev/null | wc -l | tr -d ' ') jobs)"
else
  echo "- not configured (run scripts/infra/setup-schedulers.sh)"
fi

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
