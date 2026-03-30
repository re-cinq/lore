#!/usr/bin/env bash
# Lore status line for Claude Code
# Reads session data from stdin (JSON), enriches with Lore metrics
# Configured via: claude config set statusLine '{"type":"command","command":"~/.re-cinq/lore/scripts/lore-statusline.sh"}'

INPUT=$(cat)

# ── Claude Code session data ──────────────────────────────────────────
MODEL=$(echo "$INPUT" | jq -r '.model.display_name // "unknown"' 2>/dev/null)
PCT=$(echo "$INPUT" | jq -r '.context_window.used_percentage // 0' 2>/dev/null | cut -d. -f1)
COST=$(echo "$INPUT" | jq -r '.cost.total_cost_usd // 0' 2>/dev/null)

# ── Git branch ────────────────────────────────────────────────────────
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

# ── Lore data (from cache, updated by SessionStart hook) ──────────────
CACHE="$HOME/.lore/status-cache.json"
LORE_INFO=""

if [ -f "$CACHE" ]; then
  TASKS=$(jq -r '.active_tasks // 0' "$CACHE" 2>/dev/null)
  MEMORIES=$(jq -r '.memory_count // 0' "$CACHE" 2>/dev/null)
  TODAY_COST=$(jq -r '.today_cost // "0.00"' "$CACHE" 2>/dev/null)
  REPO_STATUS=$(jq -r '.repo_status // ""' "$CACHE" 2>/dev/null)

  PARTS=""
  [ "$TASKS" != "0" ] && PARTS="${PARTS}tasks:${TASKS} "
  [ "$MEMORIES" != "0" ] && PARTS="${PARTS}mem:${MEMORIES} "
  [ "$TODAY_COST" != "0.00" ] && PARTS="${PARTS}\$${TODAY_COST} "
  [ -n "$REPO_STATUS" ] && PARTS="${REPO_STATUS} ${PARTS}"

  [ -n "$PARTS" ] && LORE_INFO=" | lore: ${PARTS% }"
fi

# ── Build output ──────────────────────────────────────────────────────
LINE="${MODEL}"
[ -n "$BRANCH" ] && LINE="${LINE} ${BRANCH}"
LINE="${LINE} ${PCT}%"
[ "$COST" != "0" ] && LINE="${LINE} \$${COST}"
LINE="${LINE}${LORE_INFO}"

echo "$LINE"
