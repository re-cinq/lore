#!/usr/bin/env bash
# Leave a trace OUTSIDE the Actions tab when a service deploy fails.
#
# A failed umbrella deploy used to leave nothing but a red X in a workflow
# nobody re-opens: the image was built and pushed, `main` carried the new code,
# and the service kept serving its previous image indefinitely and silently
# (#1650 — four merged PRs' worth of code, several services still on the old
# tag, and nothing anywhere saying so). This upserts ONE open issue per
# service — a comment when it already exists, a new issue otherwise — naming
# the tag that was requested, the image the cluster is actually running, and
# the run that failed. The issue is the same surface Lore uses for anything
# a human is expected to act on.
#
# Usage: report-deploy-failure.sh <subchart> <image_tag> <deployment> <namespace> <reason>
# No-op (exit 0) without GH_TOKEN + GITHUB_REPOSITORY, so a local run of the
# deploy script never files anything. Never fails the caller: reporting a
# failure must not mask it.
set -uo pipefail

SUBCHART="${1:?subchart, e.g. lore-floor}"
TAG="${2:?image tag that was being deployed}"
DEPLOY="${3:?deployment name}"
NS="${4:?namespace of that deployment}"
REASON="${5:?one-line reason the deploy failed}"

LABEL="deploy-failed"

if [ -z "${GH_TOKEN:-}" ] || [ -z "${GITHUB_REPOSITORY:-}" ]; then
  echo "[lore] GH_TOKEN/GITHUB_REPOSITORY unset — deploy failure not reported as an issue"
  exit 0
fi

running_image=$(kubectl -n "$NS" get "deployment/${DEPLOY}" \
  -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)
run_url="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID:-unknown}"
title="Deploy failed: ${SUBCHART} is not running ${TAG}"
body=$(
  cat <<EOF
The \`${SUBCHART}\` deploy of \`${TAG}\` failed, so \`${DEPLOY}\` (namespace \`${NS}\`) keeps serving its previous image while \`main\` already carries the new code.

| | |
| --- | --- |
| requested tag | \`${TAG}\` |
| running image | \`${running_image:-unknown}\` |
| reason | ${REASON} |
| run | ${run_url} |

Re-run the failed workflow once the cause is fixed; this issue is updated on every further failure of the same service and can be closed once the service runs the intended tag.
EOF
)

# The label has to exist before an issue can carry it; --force only updates it.
gh label create "$LABEL" --repo "$GITHUB_REPOSITORY" --color B60205 \
  --description "A service deploy failed and the cluster runs an older image than main" \
  --force >/dev/null 2>&1 || true

existing=$(gh issue list --repo "$GITHUB_REPOSITORY" --state open --label "$LABEL" \
  --search "\"${title}\" in:title" --json number --jq '.[0].number // empty' 2>/dev/null || true)

if [ -n "$existing" ]; then
  gh issue comment "$existing" --repo "$GITHUB_REPOSITORY" --body "$body" \
    && echo "[lore] deploy failure recorded on issue #${existing}" \
    || echo "[lore] could not comment on issue #${existing}"
  exit 0
fi

gh issue create --repo "$GITHUB_REPOSITORY" --title "$title" --label "$LABEL" --body "$body" \
  && echo "[lore] deploy failure filed as a new issue" \
  || echo "[lore] could not file the deploy-failure issue"
exit 0
