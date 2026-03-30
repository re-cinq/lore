#!/usr/bin/env bash
# Lore status cache updater — runs on Claude Code SessionStart
# Queries the Lore API for pipeline and memory metrics, caches to ~/.lore/status-cache.json
# Fast (<500ms) with timeouts — never blocks Claude Code startup

CACHE="$HOME/.lore/status-cache.json"
mkdir -p "$HOME/.lore"

API_URL="$(git config --global lore.api-url 2>/dev/null || echo '')"
TOKEN="$(git config --global lore.ingest-token 2>/dev/null || echo '')"

# Detect current repo from git remote
REPO=""
REMOTE=$(git remote get-url origin 2>/dev/null || echo "")
if [ -n "$REMOTE" ]; then
  REPO=$(echo "$REMOTE" | sed -E 's|.*github\.com[:/](.+/.+?)(\.git)?$|\1|' | sed 's/\.git$//')
fi

# Default values
TASKS=0
MEMORIES=0
TODAY_COST="0.00"
REPO_STATUS=""

# Query Lore health endpoint for task and cost data
if [ -n "$API_URL" ] && [ -n "$TOKEN" ]; then
  HEALTH=$(curl -sf --max-time 1 \
    -H "Authorization: Bearer ${TOKEN}" \
    "${API_URL}/healthz" 2>/dev/null || echo "{}")

  if [ -n "$HEALTH" ] && [ "$HEALTH" != "{}" ]; then
    TASKS=$(echo "$HEALTH" | jq -r '.tasks.processed_today // 0' 2>/dev/null)
    PENDING=$(echo "$HEALTH" | jq -r '.tasks.pending // 0' 2>/dev/null)
    TODAY_COST=$(echo "$HEALTH" | jq -r '.today_cost // "0.00"' 2>/dev/null)
    DB_STATUS=$(echo "$HEALTH" | jq -r '.status // "unknown"' 2>/dev/null)
    [ "$DB_STATUS" = "ok" ] && REPO_STATUS="connected" || REPO_STATUS="disconnected"
    [ "$PENDING" != "0" ] && TASKS="${TASKS}+${PENDING}p"
  fi

  # Check if current repo is onboarded
  if [ -n "$REPO" ] && [ "$REPO_STATUS" = "connected" ]; then
    REPO_STATUS="onboarded"
  fi
fi

# Write cache
cat > "$CACHE" <<EOF
{
  "repo": "${REPO}",
  "repo_status": "${REPO_STATUS}",
  "active_tasks": ${TASKS},
  "memory_count": ${MEMORIES},
  "today_cost": "${TODAY_COST}",
  "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
