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

if [ -n "$API_URL" ] && [ -n "$TOKEN" ]; then
  RESP=$(curl -sf --max-time 2 \
    -H "Authorization: Bearer ${TOKEN}" \
    "${API_URL}/api/repo-status?repo=${REPO}" 2>/dev/null || echo "")

  if [ -n "$RESP" ]; then
    echo "$RESP" | jq --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '. + {updated_at: $ts}' > "$CACHE" 2>/dev/null
    exit 0
  fi
fi

# Fallback: write minimal cache
cat > "$CACHE" <<EOF
{
  "repo": "${REPO}",
  "onboarded": false,
  "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
