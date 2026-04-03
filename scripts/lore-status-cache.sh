#!/usr/bin/env bash
# Lore status cache — runs on Claude Code SessionStart (background)
# Queries the Lore API for repo status, writes cache for the statusline.
# Fast (<2s) with timeouts — never blocks Claude Code startup.

API_URL="$(git config --global lore.api-url 2>/dev/null || echo '')"
TOKEN="$(git config --global lore.ingest-token 2>/dev/null || echo '')"

# Detect current repo from git remote
REMOTE=$(git remote get-url origin 2>/dev/null || echo "")
[ -z "$REMOTE" ] && exit 0

REPO=$(echo "$REMOTE" | sed -E 's|.*github\.com[:/](.+/.+?)(\.git)?$|\1|' | sed 's/\.git$//')
[ -z "$REPO" ] && exit 0

# Cache file keyed by repo hash (macOS: md5, Linux: md5sum)
HASH=$(echo -n "$REPO" | md5 2>/dev/null || echo -n "$REPO" | md5sum 2>/dev/null | cut -d' ' -f1)
CACHE="/tmp/lore-status-${HASH}.json"

# Defaults
ONBOARDED="false"
RUNNING=0
PR_READY=0
MEMORIES=0
AUTO_REVIEW="false"

# Helper: call MCP tool via HTTP
mcp_call() {
  local tool="$1" args="$2"
  curl -sf --max-time 2 \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"call_tool\",\"params\":{\"name\":\"${tool}\",\"arguments\":${args}}}" \
    "${API_URL}/mcp" 2>/dev/null || echo ""
}

if [ -n "$API_URL" ] && [ -n "$TOKEN" ]; then
  # Check if repo is onboarded + get settings
  REPOS_RESP=$(mcp_call "list_repos" "{}")
  if [ -n "$REPOS_RESP" ]; then
    FOUND=$(echo "$REPOS_RESP" | jq -r ".result.content[]?.text // \"\" | fromjson? | .repos[]? | select(.full_name == \"${REPO}\") | .full_name" 2>/dev/null || echo "")
    [ -n "$FOUND" ] && ONBOARDED="true"

    AR=$(echo "$REPOS_RESP" | jq -r ".result.content[]?.text // \"\" | fromjson? | .repos[]? | select(.full_name == \"${REPO}\") | .settings.auto_review // false" 2>/dev/null || echo "false")
    [ "$AR" = "true" ] && AUTO_REVIEW="true"
  fi

  if [ "$ONBOARDED" = "true" ]; then
    # Count running tasks for this repo
    RUN_RESP=$(mcp_call "list_pipeline_tasks" "{\"status\":\"running\"}")
    [ -n "$RUN_RESP" ] && RUNNING=$(echo "$RUN_RESP" | jq -r "[.result.content[]?.text // \"\" | fromjson? | .tasks[]? | select(.target_repo == \"${REPO}\")] | length" 2>/dev/null || echo 0)

    # Count PR-ready tasks
    PR_RESP=$(mcp_call "list_pipeline_tasks" "{\"status\":\"pr-created\"}")
    [ -n "$PR_RESP" ] && PR_READY=$(echo "$PR_RESP" | jq -r "[.result.content[]?.text // \"\" | fromjson? | .tasks[]? | select(.target_repo == \"${REPO}\")] | length" 2>/dev/null || echo 0)

    # Memory count
    MEM_RESP=$(mcp_call "agent_stats" "{}")
    [ -n "$MEM_RESP" ] && MEMORIES=$(echo "$MEM_RESP" | jq -r '.result.content[]?.text // "" | fromjson? | .total_memories // 0' 2>/dev/null || echo 0)
  fi
fi

# Write cache
cat > "$CACHE" <<EOF
{
  "repo": "${REPO}",
  "onboarded": ${ONBOARDED},
  "running": ${RUNNING},
  "pr_ready": ${PR_READY},
  "memories": ${MEMORIES},
  "auto_review": ${AUTO_REVIEW},
  "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
