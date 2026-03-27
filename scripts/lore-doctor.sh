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

# 3. specify CLI
check "specify CLI installed" \
  command -v specify || \
  echo "     Fix: pipx install specify-cli  OR  uv tool install specify-cli"

# 4. Git connectivity
check "Git can reach github.com" \
  timeout 5 git ls-remote --exit-code --quiet https://github.com 2>/dev/null || \
  echo "     Fix: check network connectivity"

# 5. Platform hooks
check "Platform hooks installed" \
  grep -q "re-cinq/lore" "$HOME/.claude/settings.json" 2>/dev/null || \
  echo "     Fix: node $LORE_DIR/scripts/lore-merge-settings.js"

# 6. Platform skills
check_skills() {
  [ -f "$HOME/.claude/skills/lore-feature.md" ] && \
  [ -f "$HOME/.claude/skills/lore-pr.md" ]
}
check "Platform skills installed (/lore-feature, /lore-pr)" \
  check_skills || \
  echo "     Fix: cp $LORE_DIR/.claude/skills/*.md ~/.claude/skills/"

echo ""
echo "[lore] Results: $PASS passed, $FAIL failed"

# Phase 1+ checks (optional — do not affect exit code)
echo ""
echo "Phase 1+ (optional):"

echo -n "  AlloyDB: "
if [ -n "${ALLOYDB_HOST:-}" ]; then
  if pg_isready -h "$ALLOYDB_HOST" -p 5432 -t 3 &>/dev/null; then
    echo "reachable"
  else
    echo "unreachable at $ALLOYDB_HOST"
  fi
else
  echo "- not configured (ALLOYDB_HOST not set)"
fi

echo -n "  Langfuse: "
if [ -n "${LANGFUSE_HOST:-}" ]; then
  if curl -sf --max-time 3 "$LANGFUSE_HOST/api/public/health" &>/dev/null; then
    echo "reachable"
  else
    echo "unreachable at $LANGFUSE_HOST"
  fi
else
  echo "- not configured (LANGFUSE_HOST not set)"
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

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
