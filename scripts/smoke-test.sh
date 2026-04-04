#!/bin/bash
set -euo pipefail

API_URL="${LORE_API_URL:?LORE_API_URL must be set}"
TOKEN="${LORE_INGEST_TOKEN:?LORE_INGEST_TOKEN must be set}"
FAILURES=0

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; FAILURES=$((FAILURES + 1)); }

echo "[smoke] Running post-deploy smoke tests against $API_URL"

# 1. Health
echo "[smoke] Health..."
HEALTH=$(curl -sf --max-time 5 "$API_URL/healthz" 2>/dev/null || echo "")
if echo "$HEALTH" | jq -e '.status == "ok"' >/dev/null 2>&1; then
  pass "healthz"
else
  fail "healthz: $HEALTH"
fi

# 2. Repo status
echo "[smoke] Repo status..."
REPO_STATUS=$(curl -sf --max-time 5 -H "Authorization: Bearer $TOKEN" "$API_URL/api/repo-status?repo=re-cinq/lore" 2>/dev/null || echo "")
if echo "$REPO_STATUS" | jq -e '.onboarded == true' >/dev/null 2>&1; then
  pass "repo-status"
else
  fail "repo-status: $REPO_STATUS"
fi

# 3. Create + cancel task
echo "[smoke] Task lifecycle..."
TASK=$(curl -sf --max-time 10 -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description":"[smoke-test] automated verification — safe to ignore","task_type":"general","target_repo":"re-cinq/lore","created_by":"smoke-test"}' \
  "$API_URL/api/task" 2>/dev/null || echo "")
TASK_ID=$(echo "$TASK" | jq -r '.task_id // empty' 2>/dev/null)
if [ -n "$TASK_ID" ]; then
  pass "create-task ($TASK_ID)"
  # Cancel immediately
  CANCEL=$(curl -sf --max-time 5 -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"task_id\":\"$TASK_ID\",\"action\":\"cancel\"}" \
    "$API_URL/api/task" 2>/dev/null || echo "")
  if echo "$CANCEL" | jq -e '.ok == true' >/dev/null 2>&1; then
    pass "cancel-task"
  else
    fail "cancel-task: $CANCEL"
  fi
else
  fail "create-task: $TASK"
fi

# Summary
echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "[smoke] All tests passed ✓"
  exit 0
else
  echo "[smoke] $FAILURES test(s) failed ✗"
  exit 1
fi
