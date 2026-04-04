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
  REVIEW_PREAMBLE="IMPORTANT: You have the Lore MCP server. Before reviewing:
1. Call assemble_context with template 'review' to load conventions, ADRs, and review patterns.
2. Call search_memory to check for known patterns and past review feedback on this repo.
Then proceed with the review task:"

  CLAUDE_OUTPUT=$(claude --print --dangerously-skip-permissions --verbose --model "${MODEL}" -- "${REVIEW_PREAMBLE}

${TASK_PROMPT}" 2>&1) || true
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

  # --- Build prompt with Lore workflow preamble ---
  # Job pods get the same required workflow as local sessions:
  # 1. assemble_context first, 2. search_memory before building
  LORE_PREAMBLE="IMPORTANT: You have the Lore MCP server. Follow this workflow:
1. FIRST: Call assemble_context with a query describing this task. This loads conventions, ADRs, memories, facts, and graph.
2. BEFORE CODING: Call search_memory to check if this problem was already solved or has known gotchas. Try multiple queries.
3. DURING WORK: Use search_context for patterns. Use query_graph for entity relationships.
4. WHEN DONE: Call write_episode with a summary of what you did and any non-obvious decisions.

Now execute the following task:"

  FULL_PROMPT="${LORE_PREAMBLE}

${TASK_PROMPT}"

  # --- Run Claude Code ---
  echo "[runner] Running Claude Code (model=${MODEL}, task_type=${TASK_TYPE})..."
  claude --print --dangerously-skip-permissions --verbose --model "${MODEL}" -- "${FULL_PROMPT}"

  # --- Check for changes ---
  echo "[runner] Checking for changes..."
  if [ -z "$(git status --porcelain)" ]; then
    echo "NO_CHANGES"
    # General tasks are informational (research, analysis) — no file changes expected
    if [ "$TASK_TYPE" = "general" ]; then
      exit 0
    fi
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
