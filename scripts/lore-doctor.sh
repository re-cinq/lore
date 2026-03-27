#!/usr/bin/env bash
set -euo pipefail

PASS=0
FAIL=0

check() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then
    printf '  \xe2\x9c\x93  %s\n' "$label"
    ((PASS++))
  else
    printf '  \xe2\x9c\x97  %s\n' "$label"
    echo "     -> $*"
    ((FAIL++))
  fi
}

echo "[lore] Running diagnostics..."
echo ""

# 1. MCP server entry point
check "MCP server built" \
  test -f "$HOME/.re-cinq/lore/mcp-server/dist/index.js"
[ ! -f "$HOME/.re-cinq/lore/mcp-server/dist/index.js" ] && \
  echo "     Fix: cd ~/.re-cinq/lore/mcp-server && npm install && npm run build"

# 2. bd CLI
check "bd CLI installed" \
  command -v bd
command -v bd >/dev/null 2>&1 || \
  echo "     Fix: npm install -g @beads/bd"

# 3. specify CLI
check "specify CLI installed" \
  command -v specify
command -v specify >/dev/null 2>&1 || \
  echo "     Fix: pip install specify-cli  OR  uv tool install specify-cli"

# 4. Git connectivity
check "Git can reach github.com" \
  timeout 5 git ls-remote --exit-code --quiet https://github.com 2>/dev/null
# no extra fix line — network issues are self-explanatory

# 5. Platform hooks
check "Platform hooks installed" \
  grep -q "re-cinq/lore pull" "$HOME/.claude/settings.json" 2>/dev/null
grep -q "re-cinq/lore pull" "$HOME/.claude/settings.json" 2>/dev/null || \
  echo "     Fix: node ~/.re-cinq/lore/scripts/lore-merge-settings.js"

# 6. Platform skills
SKILLS_OK=true
[ -f "$HOME/.claude/skills/lore-feature.md" ] || SKILLS_OK=false
[ -f "$HOME/.claude/skills/lore-pr.md" ] || SKILLS_OK=false
if $SKILLS_OK; then
  printf '  \xe2\x9c\x93  %s\n' "Platform skills installed"
  ((PASS++))
else
  printf '  \xe2\x9c\x97  %s\n' "Platform skills installed"
  echo "     Fix: cp ~/.re-cinq/lore/.claude/skills/*.md ~/.claude/skills/"
  ((FAIL++))
fi

echo ""
echo "[lore] Results: $PASS passed, $FAIL failed"

# Phase 1+ checks (optional — skip if infra not deployed)
echo ""
echo "Phase 1+ (optional):"

# AlloyDB reachable
echo -n "  AlloyDB: "
if [ -n "${ALLOYDB_HOST:-}" ]; then
  if pg_isready -h "$ALLOYDB_HOST" -p 5432 -t 3 &>/dev/null; then
    echo "✓ reachable"
  else
    echo "✗ unreachable at $ALLOYDB_HOST"
  fi
else
  echo "- not configured (ALLOYDB_HOST not set)"
fi

# Langfuse reachable
echo -n "  Langfuse: "
if [ -n "${LANGFUSE_HOST:-}" ]; then
  if curl -sf --max-time 3 "$LANGFUSE_HOST/api/public/health" &>/dev/null; then
    echo "✓ reachable"
  else
    echo "✗ unreachable at $LANGFUSE_HOST"
  fi
else
  echo "- not configured (LANGFUSE_HOST not set)"
fi

# Klaus endpoint
echo -n "  Klaus: "
if [ -n "${LORE_KLAUS_ENDPOINT:-}" ]; then
  if curl -sf --max-time 3 "$LORE_KLAUS_ENDPOINT/health" &>/dev/null; then
    echo "✓ reachable"
  else
    echo "✗ unreachable at $LORE_KLAUS_ENDPOINT"
  fi
else
  echo "- not configured (LORE_KLAUS_ENDPOINT not set)"
fi

# Dolt remote
echo -n "  Dolt remote: "
if command -v bd &>/dev/null && bd remote -v 2>/dev/null | grep -q origin; then
  echo "✓ configured"
else
  echo "- not configured"
fi

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
