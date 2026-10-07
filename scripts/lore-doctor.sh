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

mcp_registered() {
  command -v claude >/dev/null 2>&1 || return 1
  (cd "$HOME" && claude mcp get lore-context)
}
check "lore-context MCP server registered for every repo (claude mcp get from \$HOME)" \
  mcp_registered || \
  echo "     Fix: $LORE_DIR/scripts/install.sh (registers lore-context at user scope)"

LORE_API_URL="${LORE_API_URL:-$(git config --global lore.api-url 2>/dev/null || true)}"
LORE_TOKEN="${LORE_INGEST_TOKEN:-$(git config --global lore.ingest-token 2>/dev/null || true)}"
check "Lore API URL configured" \
  test -n "$LORE_API_URL" || \
  echo "     Fix: LORE_API_URL=https://LORE_API_DOMAIN $LORE_DIR/scripts/install.sh"
check "Lore API token configured" \
  test -n "$LORE_TOKEN" || \
  echo "     Fix: LORE_INGEST_TOKEN=<token> $LORE_DIR/scripts/install.sh"

if [ -n "$LORE_API_URL" ] && [ -n "$LORE_TOKEN" ]; then
  API_STATUS="$(curl -s -o /dev/null -m 10 -w '%{http_code}' -H "Authorization: Bearer $LORE_TOKEN" "${LORE_API_URL%/}/api/agent-stats" 2>/dev/null || true)"
  case "$API_STATUS" in
    2??)
      printf '  \xe2\x9c\x93  %s\n' "Lore API accepts the token ($LORE_API_URL)"
      PASS=$((PASS + 1))
      API_OK=1
      ;;
    401|403)
      printf '  \xe2\x9c\x97  %s\n' "Lore API token rejected (HTTP $API_STATUS)"
      echo "     Fix: get a current token from the platform team, then LORE_INGEST_TOKEN=<token> $LORE_DIR/scripts/install.sh"
      FAIL=$((FAIL + 1))
      ;;
    ""|000)
      printf '  \xe2\x9c\x97  %s\n' "Lore API unreachable at $LORE_API_URL"
      echo "     Check: the URL, your network/VPN, and the lore-api deployment"
      FAIL=$((FAIL + 1))
      ;;
    *)
      printf '  \xe2\x9c\x97  %s\n' "Lore API answered HTTP $API_STATUS at $LORE_API_URL/api/agent-stats"
      echo "     Check: the lore-api deployment (the token was not the reason)"
      FAIL=$((FAIL + 1))
      ;;
  esac
fi

if [ "${API_OK:-0}" = "1" ]; then
  if command -v jq >/dev/null 2>&1; then
    HEALTH="$(curl -sf -m 10 -H "Authorization: Bearer $LORE_TOKEN" "${LORE_API_URL%/}/healthz" 2>/dev/null || true)"
    if ! printf '%s' "$HEALTH" | jq -e 'has("embeddings")' >/dev/null 2>&1; then
      printf '  \xe2\x9c\x97  %s\n' "Embeddings status unavailable (token lacks read scope)"
      echo "     Fix: use a token with read scope"
      FAIL=$((FAIL + 1))
    elif printf '%s' "$HEALTH" | jq -e '.embeddings.consecutiveFailures == 0' >/dev/null 2>&1; then
      printf '  \xe2\x9c\x93  %s\n' "Embeddings healthy (lore-api can reach Vertex AI)"
      PASS=$((PASS + 1))
    else
      printf '  \xe2\x9c\x97  %s\n' "Embeddings unhealthy (lore-api cannot reach Vertex AI)"
      echo "     Check: kubectl -n lore-api logs deploy/lore-api | grep '\\[embeddings\\]' — a 403 is the pod's Workload Identity"
      FAIL=$((FAIL + 1))
    fi
  else
    printf '  \xe2\x97\x8b  %s\n' "Embeddings check skipped (jq not installed)"
  fi
fi

echo ""
echo "[lore] Results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
