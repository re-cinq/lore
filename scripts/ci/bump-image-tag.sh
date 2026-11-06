#!/usr/bin/env bash
# Records a freshly built image tag in the cluster values file and pushes the
# commit to main. Argo CD on the cluster deploys it from there. Replaces the
# `helm upgrade` push that deploy-lore-platform.sh used to do.
#
# Usage: bump-image-tag.sh <subchart> <tag> [values-file]
#   e.g. bump-image-tag.sh lore-api 5d270e9
set -euo pipefail

SUBCHART="${1:?subchart values key, e.g. lore-api}"
TAG="${2:?image tag}"
VALUES="${3:-deploy/clusters/n8n-cluster.values.yaml}"

# Tags are quoted on purpose: an all-digit short SHA would otherwise be read as
# a number (deploy-lore-platform.sh learned that with --set).
yq -i ".\"${SUBCHART}\".image.tag = \"${TAG}\"" "$VALUES"

if git diff --quiet -- "$VALUES"; then
  echo "[lore] ${SUBCHART} already at ${TAG}"
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add "$VALUES"
git commit -m "deploy(${SUBCHART}): ${TAG}" -m "Built from $(git rev-parse --short HEAD). Argo CD rolls it out."

# Several services build from one push; each lands its own commit. Rebase and
# retry rather than fail when a sibling got there first.
for attempt in 1 2 3 4 5 6; do
  if git push origin HEAD:main; then
    exit 0
  fi
  echo "[lore] push rejected (attempt ${attempt}); rebasing"
  git fetch origin main
  git rebase origin/main
done
echo "[lore] could not push the tag bump after 6 attempts" >&2
exit 1
