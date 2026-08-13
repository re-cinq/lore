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

# 1. MCP adapter entry point (local stdio; proxies to the Lore API)
check "MCP adapter built" \
  test -f "$LORE_DIR/apps/mcp-server/dist/index.js" || \
  echo "     Fix: cd $LORE_DIR && npm ci --ignore-scripts && npm run build -w @re-cinq/lore-shared -w @re-cinq/lore-server-core -w @re-cinq/lore-mcp"

# 2. specify CLI (optional — warn but don't count as failure)
if command -v specify >/dev/null 2>&1; then
  printf '  \xe2\x9c\x93  %s\n' "specify CLI installed"
  PASS=$((PASS + 1))
else
  printf '  \xe2\x97\x8b  %s\n' "specify CLI not installed (optional)"
  echo "     Install: pipx install specify-cli  OR  uv tool install specify-cli"
fi

# 4. Git connectivity (test SSH — GitHub returns exit 1 but prints "successfully" on success).
# Bound the attempt with ssh's own BatchMode + ConnectTimeout rather than the external
# `timeout` binary, which is absent on macOS (GNU coreutils ships it as `gtimeout`).
git_ssh_ok() {
  ssh -o BatchMode=yes -o ConnectTimeout=5 -T git@github.com 2>&1 | grep -qi "successfully" 2>/dev/null
}
check "Git can reach github.com (SSH)" \
  git_ssh_ok || \
  echo "     Fix: check SSH key config (ssh -T git@github.com)"

# 5. Platform hooks
check "Platform hooks installed" \
  grep -q "re-cinq/lore" "$HOME/.claude/settings.json" 2>/dev/null || \
  echo "     Fix: node $LORE_DIR/scripts/lore-merge-settings.js"

# 6. Platform skills — every skill the checkout ships must be installed AND match
# it. A stale copy is worse than a missing one: /lore-help would document
# behaviour the installed skill does not have.
check_skills() {
  local src="$LORE_DIR/.claude/skills" name
  [ -d "$src" ] || return 1
  for skill_dir in "$src"/*/; do
    [ -d "$skill_dir" ] || continue
    name="$(basename "$skill_dir")"
    [ -d "$HOME/.claude/skills/$name" ] || return 1
    diff -rq "$skill_dir" "$HOME/.claude/skills/$name" >/dev/null 2>&1 || return 1
  done
}
check "Platform skills installed and current (/lore-help lists them)" \
  check_skills || \
  echo "     Fix: $LORE_DIR/scripts/install.sh (refreshes changed skills)"

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
