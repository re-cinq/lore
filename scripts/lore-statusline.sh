#!/bin/bash
# Lore statusline for Claude Code
# Line 1: model, dir, git branch, context bar, duration
# Line 2: Lore repo status (conditional on onboarded repo)
#
# Configure: add to ~/.claude/settings.json:
#   "statusLine": { "type": "command", "command": "~/.re-cinq/lore/scripts/lore-statusline.sh" }
#
# Cache file is written by the SessionStart hook in install.sh

input=$(cat)

MODEL=$(echo "$input" | jq -r '.model.display_name')
DIR=$(echo "$input" | jq -r '.workspace.current_dir')
PCT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
DURATION_MS=$(echo "$input" | jq -r '.cost.total_duration_ms // 0')

CYAN='\033[36m'; GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'
DIM='\033[2m'; PURPLE='\033[35m'; RESET='\033[0m'

# Context bar color
if [ "$PCT" -ge 90 ]; then BAR_COLOR="$RED"
elif [ "$PCT" -ge 70 ]; then BAR_COLOR="$YELLOW"
else BAR_COLOR="$GREEN"; fi

FILLED=$((PCT / 10)); EMPTY=$((10 - FILLED))
printf -v FILL "%${FILLED}s"; printf -v PAD "%${EMPTY}s"
BAR="${FILL// /█}${PAD// /░}"

MINS=$((DURATION_MS / 60000)); SECS=$(((DURATION_MS % 60000) / 1000))

BRANCH=""
git rev-parse --git-dir > /dev/null 2>&1 && BRANCH=" │ 🌿 $(git branch --show-current 2>/dev/null)"

# --- Line 1: Model + dir + git + context ---
echo -e "${CYAN}[$MODEL]${RESET} 📁 ${DIR##*/}${BRANCH} │ ${BAR_COLOR}${BAR}${RESET} ${PCT}% │ ⏱️ ${MINS}m ${SECS}s"

# --- Line 2: Lore status (conditional on cache from SessionStart hook) ---
REPO=$(cd "$DIR" 2>/dev/null && git remote get-url origin 2>/dev/null | sed 's|.*github.com[:/]||;s|\.git$||')
[ -z "$REPO" ] && exit 0

# Use md5 hash of repo name for cache file (macOS: md5, Linux: md5sum)
HASH=$(echo -n "$REPO" | md5 2>/dev/null || echo -n "$REPO" | md5sum 2>/dev/null | cut -d' ' -f1)
CACHE="/tmp/lore-status-${HASH}.json"

if [ -f "$CACHE" ]; then
  ONBOARDED=$(jq -r '.onboarded // false' "$CACHE" 2>/dev/null)

  if [ "$ONBOARDED" = "true" ]; then
    RUNNING=$(jq -r '.running // 0' "$CACHE")
    PR_READY=$(jq -r '.pr_ready // 0' "$CACHE")
    MEMORIES=$(jq -r '.memories // 0' "$CACHE")
    AUTO_REVIEW=$(jq -r '.auto_review // false' "$CACHE")

    # Pending tasks from notifier
    PENDING_FILE="$HOME/.lore/pending-tasks.json"
    PENDING=0
    if [ -f "$PENDING_FILE" ]; then
      PENDING=$(jq 'length' "$PENDING_FILE" 2>/dev/null || echo 0)
    fi

    # Local tasks running in worktrees
    LOCAL=0
    if [ -d "$HOME/.lore/worktrees" ]; then
      LOCAL=$(find "$HOME/.lore/worktrees" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
    fi

    PARTS=""
    [ "$PENDING" -gt 0 ] && PARTS="${RED}${PENDING} new${RESET}"
    [ "$LOCAL" -gt 0 ] && PARTS="${PARTS:+$PARTS · }${CYAN}${LOCAL} local${RESET}"
    [ "$RUNNING" -gt 0 ] && PARTS="${PARTS:+$PARTS · }${YELLOW}${RUNNING} running${RESET}"
    [ "$PR_READY" -gt 0 ] && PARTS="${PARTS:+$PARTS · }${GREEN}${PR_READY} PR ready${RESET}"
    [ "$AUTO_REVIEW" = "true" ] && PARTS="${PARTS:+$PARTS · }auto-review"
    PARTS="${PARTS:+$PARTS · }${DIM}${MEMORIES} memories${RESET}"

    echo -e "${PURPLE}◉ Lore${RESET} ${PARTS}"
  else
    echo -e "${DIM}○ Lore: not onboarded${RESET}"
  fi
fi
