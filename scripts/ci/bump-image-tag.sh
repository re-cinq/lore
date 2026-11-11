#!/usr/bin/env bash
# Records a freshly built image tag in the cluster values file and lands it on
# main through a pull request, which branch protection requires. Argo CD on the
# cluster deploys it from there.
#
# Usage: bump-image-tag.sh <subchart> <tag> [values-file]
#   e.g. bump-image-tag.sh lore-api 5d270e9
# Needs GH_TOKEN with contents and pull-requests write.
set -euo pipefail

SUBCHART="${1:?subchart values key, e.g. lore-api}"
TAG="${2:?image tag}"
VALUES="${3:-deploy/clusters/internal-cluster.values.yaml}"
BRANCH="deploy/${SUBCHART}-${TAG}"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

# The ancestry check below needs both commits; actions/checkout is shallow.
if [ "$(git rev-parse --is-shallow-repository)" = true ]; then
  git fetch --quiet --unshallow origin main
fi

# Several services build from one push, each with its own pull request. When a
# sibling merges first, the branch is rebuilt on the new main and merged again.
for attempt in 1 2 3 4 5 6; do
  git fetch --quiet origin main
  git checkout --quiet -B "$BRANCH" origin/main

  # A build that finishes late must not take the service back to an older commit.
  CURRENT=$(yq ".\"${SUBCHART}\".image.tag" "$VALUES")
  if git merge-base --is-ancestor "$TAG" "$CURRENT" 2>/dev/null; then
    echo "[lore] ${SUBCHART} already at ${CURRENT}, which contains ${TAG}"
    exit 0
  fi

  # Tags are quoted on purpose: an all-digit short SHA would otherwise be read
  # as a number.
  yq -i ".\"${SUBCHART}\".image.tag = \"${TAG}\"" "$VALUES"

  if git diff --quiet -- "$VALUES"; then
    echo "[lore] ${SUBCHART} already at ${TAG}"
    exit 0
  fi

  git commit --quiet -am "deploy(${SUBCHART}): ${TAG}" -m "Built from ${GITHUB_SHA:-$(git rev-parse --short HEAD)}. Argo CD rolls it out."
  git push --quiet --force origin "HEAD:refs/heads/${BRANCH}"

  if ! gh pr view "$BRANCH" --json state --jq .state 2>/dev/null | grep -q OPEN; then
    gh pr create --base main --head "$BRANCH" \
      --title "deploy(${SUBCHART}): ${TAG}" \
      --body "Image tag bump from the build workflow. Argo CD rolls it out once merged."
  fi

  if gh pr merge "$BRANCH" --squash --delete-branch; then
    exit 0
  fi
  echo "[lore] merge of ${BRANCH} failed (attempt ${attempt}); rebuilding on main"
  sleep $((attempt * 5))
done
echo "[lore] could not merge the tag bump after 6 attempts" >&2
exit 1
