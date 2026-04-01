#!/usr/bin/env bash
set -euo pipefail

# --- Configuration ---
MODEL="${MODEL:-claude-sonnet-4-6}"
TASK_TYPE="${TASK_TYPE:-implementation}"

if [ "$TASK_TYPE" = "review" ]; then
  # =====================
  # Review flow
  # =====================

  # --- Validate required env vars ---
  echo "[runner] Validating environment (review mode)..."
  missing=()
  for var in GITHUB_TOKEN TARGET_REPO PR_NUMBER TASK_PROMPT; do
    if [ -z "${!var:-}" ]; then
      missing+=("$var")
    fi
  done

  if [ ${#missing[@]} -gt 0 ]; then
    echo "[runner] ERROR: Missing required env vars: ${missing[*]}"
    exit 1
  fi

  # --- Configure git ---
  echo "[runner] Configuring git..."
  git config --global user.name "Lore Agent"
  git config --global user.email "lore@re-cinq.com"

  # --- Configure gh auth ---
  echo "[runner] Authenticating GitHub CLI..."
  export GH_TOKEN="$GITHUB_TOKEN"

  # --- Clone repo and checkout PR branch ---
  echo "[runner] Cloning ${TARGET_REPO}..."
  git clone "https://x-access-token:${GITHUB_TOKEN}@github.com/${TARGET_REPO}.git" /workspace/repo
  cd /workspace/repo

  echo "[runner] Checking out PR #${PR_NUMBER}..."
  gh pr checkout "${PR_NUMBER}"

  # --- Run Claude Code for review ---
  echo "[runner] Running Claude Code review (model=${MODEL})..."
  CLAUDE_OUTPUT=$(claude --print --dangerously-skip-permissions --verbose --model "${MODEL}" -- "${TASK_PROMPT}" 2>&1) || true
  echo "$CLAUDE_OUTPUT"

  # --- Parse review result ---
  echo "[runner] Parsing review result..."
  if echo "$CLAUDE_OUTPUT" | grep -qE "REVIEW_RESULT:APPROVED|REVIEW_APPROVED"; then
    RESULT="APPROVED"
    echo "$RESULT" > /tmp/review-result.txt
  elif echo "$CLAUDE_OUTPUT" | grep -qE "REVIEW_RESULT:CHANGES_REQUESTED|REVIEW_CHANGES_REQUESTED"; then
    FEEDBACK=$(echo "$CLAUDE_OUTPUT" | grep -oE "(REVIEW_RESULT:CHANGES_REQUESTED|REVIEW_CHANGES_REQUESTED)[: ]*(.*)" | head -1 | sed 's/.*CHANGES_REQUESTED[: ]*//')
    RESULT="CHANGES_REQUESTED:${FEEDBACK}"
    echo "$RESULT" > /tmp/review-result.txt
  else
    echo "[runner] WARNING: Could not parse structured result, treating as changes-requested"
    RESULT="CHANGES_REQUESTED:${CLAUDE_OUTPUT: -500}"
    echo "$RESULT" > /tmp/review-result.txt
  fi

  echo "REVIEW_RESULT:${RESULT}"
  echo "[runner] Review done."

else
  # =====================
  # Implementation flow
  # =====================

  # --- Validate required env vars ---
  echo "[runner] Validating environment..."
  missing=()
  for var in GITHUB_TOKEN TARGET_REPO BRANCH_NAME TASK_PROMPT; do
    if [ -z "${!var:-}" ]; then
      missing+=("$var")
    fi
  done

  if [ ${#missing[@]} -gt 0 ]; then
    echo "[runner] ERROR: Missing required env vars: ${missing[*]}"
    exit 1
  fi

  # --- Configure git ---
  echo "[runner] Configuring git..."
  git config --global user.name "Lore Agent"
  git config --global user.email "lore@re-cinq.com"

  # --- Clone repo ---
  echo "[runner] Cloning ${TARGET_REPO}..."
  git clone --depth=1 "https://x-access-token:${GITHUB_TOKEN}@github.com/${TARGET_REPO}.git" /workspace/repo

  # --- Create branch ---
  cd /workspace/repo
  echo "[runner] Creating branch ${BRANCH_NAME}..."
  git checkout -b "${BRANCH_NAME}"

  # --- Run Claude Code ---
  echo "[runner] Running Claude Code (model=${MODEL}, task_type=${TASK_TYPE})..."
  claude --print --dangerously-skip-permissions --verbose --model "${MODEL}" -- "${TASK_PROMPT}"

  # --- Check for changes ---
  echo "[runner] Checking for changes..."
  if [ -z "$(git status --porcelain)" ]; then
    echo "NO_CHANGES"
    exit 1
  fi

  # --- Commit and push ---
  BRANCH_SLUG="${BRANCH_NAME##*/}"
  echo "[runner] Committing changes..."
  git add -A
  git commit -m "lore: ${TASK_TYPE} — ${BRANCH_SLUG}"

  echo "[runner] Pushing to origin/${BRANCH_NAME}..."
  git push origin "${BRANCH_NAME}"

  echo "CHANGES=$(git diff --stat HEAD~1 | tail -1)"
  echo "[runner] Done."
fi
