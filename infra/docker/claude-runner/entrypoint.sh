#!/usr/bin/env bash
set -euo pipefail

# --- Configuration ---
MODEL="${MODEL:-claude-sonnet-4-6}"
# TASK_TYPE intentionally has no default — the env-var validation block
# below catches missing values loudly. Defaulting to "implementation"
# would silently mask a controller misconfiguration.
TASK_TYPE="${TASK_TYPE:-}"

# =====================
# Dark Factory mode (PR #309)
# =====================
# When LORE_DARK_FACTORY_WORKFLOW is set, route the entire pod through
# the supervisor + workflow graph instead of the legacy claude --print
# + validate + commit flow. The supervisor walks the graph (commits per
# stage with Lore-Stage:/Lore-Iteration:/Lore-Task: trailers), refreshes
# the lease per node, and returns 0 on completion. The loretask-watcher
# then creates the PR as it does today.
if [ -n "${LORE_DARK_FACTORY_WORKFLOW:-}" ]; then
  echo "[runner] Dark-factory mode (workflow=${LORE_DARK_FACTORY_WORKFLOW})"

  # --- Validate required env vars ---
  missing=()
  for var in GITHUB_TOKEN TARGET_REPO BRANCH_NAME TASK_DESCRIPTION TASK_TYPE LORE_TASK_ID BASE_BRANCH; do
    if [ -z "${!var:-}" ]; then
      missing+=("$var")
    fi
  done
  if [ ${#missing[@]} -gt 0 ]; then
    echo "[runner] ERROR: Missing required env vars (dark-factory): ${missing[*]}"
    exit 1
  fi

  # --- Configure git ---
  git config --global user.name "Lore Agent"
  git config --global user.email "lore@re-cinq.com"

  # --- Clone repo + branch ---
  git clone --depth=1 \
    "https://x-access-token:${GITHUB_TOKEN}@github.com/${TARGET_REPO}.git" \
    /workspace/repo
  cd /workspace/repo
  git checkout -b "${BRANCH_NAME}"

  # --- Hand off to the supervisor CLI ---
  # The supervisor walks the workflow graph; agent nodes spawn `claude`
  # inside the same workdir, retrospective writes the stage commit,
  # iteration_max bounds loops. exit code 0 = workflow completed.
  export WORKDIR=/workspace/repo
  export GIT_AUTHOR_NAME="Lore Agent"
  export GIT_AUTHOR_EMAIL="lore@re-cinq.com"
  export GIT_COMMITTER_NAME="Lore Agent"
  export GIT_COMMITTER_EMAIL="lore@re-cinq.com"

  # task-types.yaml is baked into the image at /config/task-types.yaml
  # by the Dockerfile. runner-cli's loadTaskTypes() defaults to that
  # path; setting it explicitly here makes the lookup traceable in
  # `kubectl logs` and lets us override per-pod from the controller.
  export TASK_TYPES_PATH="${TASK_TYPES_PATH:-/config/task-types.yaml}"

  # The runner CLI lives in the agent build, copied into /app/dist by
  # the multi-stage Dockerfile; the workflow YAMLs it loads ship in the
  # runner kernel at /app/libs/runner/dist/workflows/*.yaml.
  node /app/dist/delivery/runner-cli.js
  RUNNER_EXIT=$?
  echo "[runner] runner-cli exited with ${RUNNER_EXIT}"

  if [ "$RUNNER_EXIT" = "0" ]; then
    echo "[runner] Pushing dark-factory branch..."
    git push origin "${BRANCH_NAME}"
    # Stage commits are emitted with --allow-empty (FR1.4 audit substrate),
    # so counting commits is misleading. Diff against the base branch
    # tells us whether any actual files changed.
    if git diff --quiet "origin/${BASE_BRANCH}..HEAD" --; then
      echo "CHANGES=0"
    else
      echo "CHANGES=1"
    fi
    echo "[runner] Dark-factory done."
    exit 0
  fi

  # Non-zero exit is the contract — the loretask-watcher treats any
  # non-zero as task failure → needs-human-help label. No stdout marker
  # needed (a second parallel signaling channel can drift from the exit
  # code one).
  exit "${RUNNER_EXIT}"
fi

if [ "$TASK_TYPE" = "review" ]; then
  # =====================
  # Review flow
  # =====================

  # --- Validate required env vars ---
  echo "[runner] Validating environment (review mode)..."
  missing=()
  for var in GITHUB_TOKEN TARGET_REPO PR_NUMBER TASK_PROMPT TASK_TYPE; do
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
1. Call lore_assemble_context with template 'review' to load conventions, ADRs, and review patterns.
2. Call lore_search_memory to check for known patterns and past review feedback on this repo.
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
  for var in GITHUB_TOKEN TARGET_REPO BRANCH_NAME TASK_PROMPT TASK_TYPE; do
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

  # --- Pre-run context hydration (Minions-inspired) ---
  # Fetch assembled context BEFORE running Claude Code so the agent starts
  # with conventions, ADRs, memories, and graph on turn 1.
  LORE_API_URL="${LORE_API_URL:-}"
  LORE_TOKEN="${LORE_INGEST_TOKEN:-}"
  PRE_CONTEXT=""
  if [ -n "$LORE_API_URL" ] && [ -n "$LORE_TOKEN" ]; then
    echo "[runner] Fetching pre-run context..."
    TEMPLATE="implementation"
    if [ "$TASK_TYPE" = "review" ]; then TEMPLATE="review"; fi
    QUERY=$(echo "$TASK_PROMPT" | head -c 200 | jq -sRr @uri)
    PRE_CONTEXT=$(curl -sf --max-time 10 \
      -H "Authorization: Bearer $LORE_TOKEN" \
      "${LORE_API_URL}/api/context?repo=${TARGET_REPO}&template=${TEMPLATE}&query=${QUERY}" \
      | jq -r '.text // empty' 2>/dev/null) || true
    if [ -n "$PRE_CONTEXT" ]; then
      echo "[runner] Pre-loaded $(echo "$PRE_CONTEXT" | wc -c | tr -d ' ') bytes of context."
    else
      echo "[runner] No pre-loaded context available."
    fi
  fi

  # --- Build prompt with Lore workflow preamble ---
  if [ -n "$PRE_CONTEXT" ]; then
    LORE_PREAMBLE="## Pre-loaded Context

${PRE_CONTEXT}

---

Context was pre-loaded above. You may call lore_assemble_context for fresh data during long tasks.
2. BEFORE CODING: Call lore_search_memory to check if this problem was already solved or has known gotchas. Try multiple queries.
3. DURING WORK: Use lore_search_context for patterns. Use lore_query_graph for entity relationships.
4. WHEN DONE: Call lore_write_episode with a summary of what you did and any non-obvious decisions.

Now execute the following task:"
  else
    LORE_PREAMBLE="IMPORTANT: You have the Lore MCP server. Follow this workflow:
1. FIRST: Call lore_assemble_context with a query describing this task. This loads conventions, ADRs, memories, facts, and graph.
2. BEFORE CODING: Call lore_search_memory to check if this problem was already solved or has known gotchas. Try multiple queries.
3. DURING WORK: Use lore_search_context for patterns. Use lore_query_graph for entity relationships.
4. WHEN DONE: Call lore_write_episode with a summary of what you did and any non-obvious decisions.

Now execute the following task:"
  fi

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

  # --- Deterministic validation (Minions-inspired) ---
  # Run lint/typecheck as mandatory pipeline stages before commit.
  CHANGED_FILES=$(git diff --name-only)
  VALIDATION_SCRIPT="/validation.js"
  MAX_RETRIES=1
  RETRY_COUNT=0

  if [ -f "$VALIDATION_SCRIPT" ]; then
    echo "[runner] Running pre-flight validation..."
    VALIDATION_OUTPUT=$(node "$VALIDATION_SCRIPT" --quick --repo /workspace/repo --files "$CHANGED_FILES" 2>&1) || {
      VALIDATION_EXIT=$?
      echo "[runner] Validation failed (attempt 1):"
      echo "$VALIDATION_OUTPUT"

      if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
        RETRY_COUNT=$((RETRY_COUNT + 1))
        echo "[runner] Attempting fix retry..."

        # Extract just the error lines for the fix prompt
        FIX_ERRORS=$(echo "$VALIDATION_OUTPUT" | grep -A 100 "^\[FAIL\]" || echo "$VALIDATION_OUTPUT")

        FIX_PROMPT="Validation checks failed after your changes. Fix ONLY these errors.
Do not re-implement the original task. Only fix the validation errors.

${FIX_ERRORS}"

        claude --print --dangerously-skip-permissions --model "${MODEL}" -- "${FIX_PROMPT}" || true

        # Re-validate
        echo "[runner] Re-validating after fix..."
        CHANGED_FILES=$(git diff --name-only)
        node "$VALIDATION_SCRIPT" --quick --repo /workspace/repo --files "$CHANGED_FILES" 2>&1 || {
          echo "NEEDS_HUMAN_HELP"
          echo "[runner] Validation still failing after retry. Pushing for human review."
        }
      fi
    }
  else
    echo "[runner] No validation script found, skipping pre-flight checks."
  fi

  # --- Commit and push ---
  BRANCH_SLUG="${BRANCH_NAME##*/}"
  echo "[runner] Committing changes..."
  git add -A
  git commit -m "lore: ${TASK_TYPE} — ${BRANCH_SLUG}"

  echo "[runner] Pushing to origin/${BRANCH_NAME}..."
  git push origin "${BRANCH_NAME}"

  CHANGED_COUNT=$(git diff --stat HEAD~1 | tail -1 | grep -oE '^\s*[0-9]+' | tr -d ' ')
  echo "CHANGES=${CHANGED_COUNT:-0}"
  echo "[runner] Done."
fi
