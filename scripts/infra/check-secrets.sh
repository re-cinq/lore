#!/usr/bin/env bash
# Verify the platform's secrets are (a) present and (b) actually loaded.
#
# Two different failures, both silent until they are not:
#
#   MISSING  — a container with no enabled version. Pods CrashLoop or 401 on
#              first use. Caught by seed-secrets.sh --check.
#   STALE    — GCP Secret Manager holds a NEWER version than the running pods
#              ever read. Everything is green, because the pod and its peer both
#              still hold the old value — right up until an unrelated restart
#              flips one side and the fleet starts refusing each other. This is
#              the failure that used to be found by an outage.
#
# The secret -> consumer mapping is NOT hardcoded: it is read from the live
# ExternalSecret resources, so a new consumer is covered the day it is deployed.
#
#   ./scripts/infra/check-secrets.sh          # human-readable, exit 1 on any problem
#
# Fix a STALE row by restarting the named workloads. No value is ever printed.
set -euo pipefail

log() { echo "[lore] $*"; }
die() { echo "[lore] ERROR: $*" >&2; exit 1; }

command -v gcloud >/dev/null || die "gcloud not found"
command -v kubectl >/dev/null || die "kubectl not found"
command -v jq >/dev/null || die "jq not found"

problems=0

# --- presence -------------------------------------------------------------
log "Checking Secret Manager for enabled versions"
"$(dirname "$0")/seed-secrets.sh" --check || problems=1

# --- staleness ------------------------------------------------------------
#
# For each ExternalSecret: which GSM secrets does it pull, and which K8s Secret
# does it write? Then: which pods consume that K8s Secret, and did they start
# before the newest GSM version was created?
log "Checking whether running pods loaded the current versions"

es_json="$(kubectl get externalsecrets -A -o json)"
pods_json="$(kubectl get pods -A --field-selector=status.phase=Running -o json)"

# secret_name<TAB>namespace<TAB>k8s_secret_name
mappings="$(printf '%s' "$es_json" | jq -r '
  .items[]
  | .metadata.namespace as $ns
  | (.spec.target.name // .metadata.name) as $target
  | .spec.data[]?.remoteRef.key
  | "\(.)\t\($ns)\t\($target)"
' | sort -u)"

# A pod consumes a Secret through env, envFrom, volumes, or imagePullSecrets.
# imagePullSecrets are excluded: they are read at image-pull time, so a rotation
# needs no restart and a "stale" pod is not a defect.
pods_using() {
  local ns="$1" secret="$2"
  printf '%s' "$pods_json" | jq -r --arg ns "$ns" --arg s "$secret" '
    .items[]
    | select(.metadata.namespace == $ns)
    | select(
        [ (.spec.containers[]?, .spec.initContainers[]?)
          | (.env[]?.valueFrom.secretKeyRef.name // empty),
            (.envFrom[]?.secretRef.name // empty)
        ] + [ .spec.volumes[]?.secret.secretName // empty ]
        | index($s)
      )
    | "\(.metadata.name)\t\(.status.startTime)"
  '
}

while IFS=$'\t' read -r secret ns k8s_secret; do
  [ -n "$secret" ] || continue

  version_time="$(gcloud secrets versions list "$secret" \
    --filter='state:ENABLED' --sort-by='~createTime' --limit=1 \
    --format='value(createTime)' 2>/dev/null || true)"
  [ -n "$version_time" ] || continue

  version_epoch="$(date -d "$version_time" +%s 2>/dev/null || echo 0)"
  [ "$version_epoch" -gt 0 ] || continue

  stale_pods=""
  while IFS=$'\t' read -r pod start; do
    [ -n "$pod" ] || continue
    pod_epoch="$(date -d "$start" +%s 2>/dev/null || echo 0)"
    [ "$pod_epoch" -gt 0 ] || continue
    # ESO refreshes hourly, so a pod is only trusted to hold the current value
    # if it started at least one refresh interval after the version landed.
    if [ "$pod_epoch" -lt "$((version_epoch + 3600))" ]; then
      stale_pods="$stale_pods $pod"
    fi
  done <<< "$(pods_using "$ns" "$k8s_secret")"

  if [ -n "$stale_pods" ]; then
    log "STALE  $secret (version $version_time) -> $ns/$k8s_secret"
    log "       pods predating it:$stale_pods"
    log "       fix: kubectl rollout restart deployment -n $ns"
    problems=1
  fi
done <<< "$mappings"

if [ "$problems" -ne 0 ]; then
  log "Secret check FAILED — see above."
  exit 1
fi

log "All secrets present, and every consuming pod has read the current version."
