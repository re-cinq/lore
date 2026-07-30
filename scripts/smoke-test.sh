#!/bin/bash
set -euo pipefail

API_URL="${LORE_API_URL:?LORE_API_URL must be set}"
TOKEN="${LORE_INGEST_TOKEN:?LORE_INGEST_TOKEN must be set}"
FAILURES=0

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; FAILURES=$((FAILURES + 1)); }

echo "[smoke] Running post-deploy smoke tests against $API_URL"

# 1. Health — retried: smoke runs right after a rolling deploy, so the LB can
# briefly route to a pod that hasn't passed its readiness probe yet. A single
# shot here false-failed otherwise-healthy deploys (the checks below pass a
# moment later). Poll up to 5×/3s before declaring it down.
echo "[smoke] Health..."
HEALTH=""
for _ in $(seq 1 5); do
  HEALTH=$(curl -sf --max-time 5 "$API_URL/healthz" 2>/dev/null || echo "")
  echo "$HEALTH" | jq -e '.status == "ok"' >/dev/null 2>&1 && break
  sleep 3
done
if echo "$HEALTH" | jq -e '.status == "ok"' >/dev/null 2>&1; then
  pass "healthz"
else
  fail "healthz: $HEALTH"
fi

# 2. Repo status — retried for the same reason as healthz: right after a rolling
# deploy the DB behind this endpoint can stall briefly (migration hook + startup
# reconcile), and a single shot false-failed an otherwise-healthy deploy.
echo "[smoke] Repo status..."
REPO_STATUS=""
for _ in $(seq 1 5); do
  REPO_STATUS=$(curl -sf --max-time 5 -H "Authorization: Bearer $TOKEN" "$API_URL/api/repo-status?repo=re-cinq/lore" 2>/dev/null || echo "")
  echo "$REPO_STATUS" | jq -e '.onboarded == true' >/dev/null 2>&1 && break
  sleep 3
done
if echo "$REPO_STATUS" | jq -e '.onboarded == true' >/dev/null 2>&1; then
  pass "repo-status"
else
  fail "repo-status: $REPO_STATUS"
fi

# NOTE: no task create/cancel check here on purpose. A post-deploy smoke test is
# a GitHub Actions concern — its verdict belongs on the CI check, not in Lore's
# task table. POSTing to /api/task left a permanent cancelled row per deploy
# (cancel is a soft status change, not a delete) that surfaced as a phantom
# "Failed" assembly-line run and briefly enqueued a real, dispatchable task on
# prod. healthz + repo-status already prove the service + DB are live. If write-
# path coverage is ever wanted, use a non-persisting probe (invalid body → 400).

# Summary
echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "[smoke] All tests passed ✓"
  exit 0
else
  echo "[smoke] $FAILURES test(s) failed ✗"
  exit 1
fi
