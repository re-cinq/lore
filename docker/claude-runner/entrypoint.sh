#!/usr/bin/env bash
set -euo pipefail

# --- Configuration ---
MODEL="${MODEL:-claude-sonnet-4-6}"
TASK_TYPE="${TASK_TYPE:-implementation}"

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
