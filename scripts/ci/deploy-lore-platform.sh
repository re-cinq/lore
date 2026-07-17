#!/usr/bin/env bash
# Deploy ONE service's image into the single `lore-platform` umbrella release.
#
# The platform is one Helm release, but each service (floor/mcp/ui) is bumped by
# its own CI workflow — so several `helm upgrade lore-platform` can be triggered
# at once (e.g. a libs/shared change rebuilds floor + mcp). We must serialize
# them without dropping any. A GitHub `concurrency` group can't (it keeps only one
# pending run and cancels the rest), so we serialize on Helm's own release lock:
#   - retry while another deploy holds the lock ("another operation … in progress")
#   - clear ONLY a STALE (>5m) pending revision left by a dead run — never an
#     active concurrent deploy's fresh lock.
#
# Usage: deploy-lore-platform.sh <subchart> <image_tag> <deployment> <namespace> [image_repo] [values_overlay]
#   e.g. deploy-lore-platform.sh lore-api 5d270e9 lore-api lore-api
# An image_tag of "-" deploys the chart as checked out with no image override —
# for subcharts whose images are digest-pinned in values.yaml (ai-agents).
# `values_overlay` (a YAML/JSON file) is passed with -f AFTER the reused values,
# so its keys win over the release's stored user-supplied values. The release
# carries a full legacy ai-agents block that would otherwise shadow every
# values.yaml edit under --reset-then-reuse-values (2026-07-16: a memory-limit
# bump deployed green and changed nothing).
set -euo pipefail

SUBCHART="${1:?subchart values key, e.g. lore-floor}"
TAG="${2:?image tag, or - for no image override}"
DEPLOY="${3:?deployment name for rollout status}"
NS="${4:?namespace of that deployment}"
IMAGE_REPO="${5:-}" # optional: pin image.repository too
VALUES_OVERLAY="${6:-}" # optional: -f overlay that outranks stored release values

CHART="infra/terraform/modules/gke-mcp/lore-platform"

# Pin the repository we just built, not only the tag. --reset-then-reuse-values
# reuses the prior release's values on top of the new chart default, so after a
# package rename (lore-mcp -> lore-api) the old repository lingers and new tags
# 404 against the dead package. An explicit --set overrides that stale value.
repo_set=()
if [ -n "$IMAGE_REPO" ]; then
  repo_set+=(--set "${SUBCHART}.image.repository=${IMAGE_REPO}")
fi
tag_set=()
if [ "$TAG" != "-" ]; then
  tag_set+=(--set "${SUBCHART}.image.tag=${TAG}")
fi
overlay_flags=()
if [ -n "$VALUES_OVERLAY" ]; then
  overlay_flags+=(-f "$VALUES_OVERLAY")
fi
HOME_NS="lore-floor" # the umbrella release record lives here
STALE_SECS=300       # a pending revision older than this is from a dead run, not an active deploy
ATTEMPTS=12
ERRLOG="$(mktemp)"

# Clear a pending-* revision secret ONLY if it is older than STALE_SECS — i.e. a
# wedged leftover from an interrupted run, not the fresh lock of a deploy running
# right now in another workflow.
clear_stale_lock() {
  local now name status ts created age
  now=$(date +%s)
  kubectl get secret -n "$HOME_NS" -l "owner=helm,name=lore-platform" \
    -o jsonpath='{range .items[*]}{.metadata.name}|{.metadata.labels.status}|{.metadata.creationTimestamp}{"\n"}{end}' 2>/dev/null \
    | while IFS='|' read -r name status ts; do
        case "$status" in pending-*) ;; *) continue ;; esac
        created=$(date -d "$ts" +%s 2>/dev/null || echo "$now")
        age=$((now - created))
        if [ "$age" -gt "$STALE_SECS" ]; then
          echo "[lore] clearing stale pending revision $name (${age}s old — dead run)"
          kubectl delete secret -n "$HOME_NS" "$name" || true
        else
          echo "[lore] pending revision $name is fresh (${age}s) — a concurrent deploy holds it; will retry"
        fi
      done
}

for attempt in $(seq 1 "$ATTEMPTS"); do
  clear_stale_lock
  # --reset-then-reuse-values keeps the other subcharts' tags + terraform config.
  # Disable the lore-db ownership-reconciler hook: CI's SA can't manage lore-db
  # RBAC, and an image bump never needs to reconcile DB ownership (terraform does).
  # taskTypesConfig is re-sent from the repo on EVERY deploy: it used to be set
  # only by terraform apply, so the floor/lore-api ConfigMaps froze at whatever
  # scripts/task-types.yaml said back then (2026-07-17: every code-review ran
  # with the pre-#840 gh-based prompt and posted nothing).
  # No --wait (Autopilot wedges on it); rollout is gated by kubectl below.
  if helm upgrade --install lore-platform "$CHART" \
      --namespace "$HOME_NS" \
      "${tag_set[@]}" \
      "${repo_set[@]}" \
      "${overlay_flags[@]}" \
      --set lore-db-helm.ownershipReconciler.enabled=false \
      --set-file lore-floor.taskTypesConfig=scripts/task-types.yaml \
      --set-file lore-api.taskTypesConfig=scripts/task-types.yaml \
      --reset-then-reuse-values \
      --cleanup-on-fail 2>"$ERRLOG"; then
    cat "$ERRLOG" >&2 || true # surface any helm warnings
    echo "[lore] ${SUBCHART} deployed at ${TAG}; waiting for rollout"
    if kubectl rollout status "deployment/${DEPLOY}" -n "$NS" --timeout=5m; then
      exit 0
    fi
    echo "[lore] rollout FAILED for deployment/${DEPLOY} in ${NS} — dumping diagnostics"
    kubectl -n "$NS" get pods -l "app=${DEPLOY}" -o wide || true
    echo "----- describe pod -----"
    kubectl -n "$NS" describe pod -l "app=${DEPLOY}" || true
    echo "----- current logs -----"
    kubectl -n "$NS" logs -l "app=${DEPLOY}" --all-containers --tail=150 --prefix || true
    echo "----- previous logs (last crash, if any) -----"
    kubectl -n "$NS" logs -l "app=${DEPLOY}" --all-containers --previous --tail=150 --prefix || true
    echo "----- recent namespace events -----"
    kubectl -n "$NS" get events --sort-by=.lastTimestamp | tail -60 || true
    exit 1
  fi
  cat "$ERRLOG" >&2 # surface the failure in the CI log
  if grep -qiE 'another operation \(.*\) is in progress' "$ERRLOG"; then
    echo "[lore] release locked by a concurrent deploy; retry ${attempt}/${ATTEMPTS} in 30s"
    sleep 30
    continue
  fi
  echo "[lore] helm upgrade failed (not lock contention):"
  cat "$ERRLOG"
  exit 1
done

echo "[lore] gave up after ${ATTEMPTS} attempts waiting for the release lock"
exit 1
