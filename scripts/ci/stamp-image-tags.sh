#!/usr/bin/env bash
# Writes a release version into the five image tags of an install values file,
# so the chart a release publishes names that version whatever the committed
# file says. Run it on the staged copy, never on deploy/install/values.yaml.
# Usage: stamp-image-tags.sh <values file> <vMAJOR.MINOR.PATCH>
set -euo pipefail

VALUES="${1:?values file}"
TAG="${2:?version, e.g. v1.0.1}"
PLATFORM='.["lore-platform"]'

[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "[lore] '${TAG}' is not vMAJOR.MINOR.PATCH" >&2
  exit 1
}

export TAG
yq -i "
  ${PLATFORM}.\"lore-api\".image.tag = strenv(TAG) |
  ${PLATFORM}.\"lore-mcp-gateway\".image.tag = strenv(TAG) |
  ${PLATFORM}.\"lore-ui\".image.tag = strenv(TAG) |
  ${PLATFORM}.\"lore-stations\".image.tag = strenv(TAG) |
  ${PLATFORM}.\"lore-api\".floor.agentImage |= sub(\":[^:/@]*(@.*)?\$\"; \":\" + strenv(TAG))
" "$VALUES"
echo "[lore] ${VALUES} names every image at ${TAG}"
