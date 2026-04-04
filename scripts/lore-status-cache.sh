#!/usr/bin/env bash
# Lore status cache — runs on Claude Code SessionStart (background)
# Queries /api/repo-status for the current repo, writes cache for the statusline.
# Fast (<1s) — single HTTP call.

API_URL="$(git config --global lore.api-url 2>/dev/null || echo '')"
TOKEN="$(git config --global lore.ingest-token 2>/dev/null || echo '')"

# Detect current repo from git remote
REMOTE=$(git remote get-url origin 2>/dev/null || echo "")
[ -z "$REMOTE" ] && exit 0

REPO=$(echo "$REMOTE" | sed 's|.*github\.com[:/]||' | sed 's|\.git$||')
[ -z "$REPO" ] && exit 0

# Cache file keyed by repo hash (macOS: md5, Linux: md5sum)
HASH=$(echo -n "$REPO" | md5 2>/dev/null || echo -n "$REPO" | md5sum 2>/dev/null | cut -d' ' -f1)
CACHE="/tmp/lore-status-${HASH}.json"

# Count local tasks from ~/.lore/worktrees/
LOCAL_COUNT=0
if [ -d "$HOME/.lore/worktrees" ]; then
  LOCAL_COUNT=$(find "$HOME/.lore/worktrees" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
fi

if [ -n "$API_URL" ] && [ -n "$TOKEN" ]; then
  RESP=$(curl -sf --max-time 2 \
    -H "Authorization: Bearer ${TOKEN}" \
    "${API_URL}/api/repo-status?repo=${REPO}" 2>/dev/null || echo "")

  if [ -n "$RESP" ]; then
    echo "$RESP" | jq --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson local "$LOCAL_COUNT" \
      '. + {updated_at: $ts, local_tasks: $local}' > "$CACHE" 2>/dev/null
    exit 0
  fi
fi

# Fallback: write minimal cache
cat > "$CACHE" <<EOF
{
  "repo": "${REPO}",
  "onboarded": false,
  "local_tasks": ${LOCAL_COUNT},
  "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
