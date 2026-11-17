#!/usr/bin/env bash
# Fails unless deploy/install/values.yaml pins all five Lore images to <version>,
# so a release tag can never ship an install chart that points elsewhere.
# Usage: check-install-pins.sh <vMAJOR.MINOR.PATCH>
set -euo pipefail

VERSION="${1:?version, e.g. v1.0.0}"
VALUES="${VALUES:-deploy/install/values.yaml}"
PLATFORM='.["lore-platform"]'

failed=0
check() {
  local name="$1" actual="$2"
  if [[ "$actual" != "$VERSION" ]]; then
    echo "[lore] ${name} is pinned to '${actual}', not ${VERSION}" >&2
    failed=1
  fi
}

check lore-api "$(yq "${PLATFORM}.\"lore-api\".image.tag" "$VALUES")"
check lore-mcp "$(yq "${PLATFORM}.\"lore-mcp-gateway\".image.tag" "$VALUES")"
check lore-ui "$(yq "${PLATFORM}.\"lore-ui\".image.tag" "$VALUES")"
check lore-stations "$(yq "${PLATFORM}.\"lore-stations\".image.tag" "$VALUES")"
check lore-agent "$(yq "${PLATFORM}.\"lore-api\".floor.agentImage | sub(\"^.*:\"; \"\")" "$VALUES")"
guide_versions="$(sed -n '/^### 3\.8 /q; s|.*oci://ghcr.io/re-cinq/charts/lore-install --version \([0-9.]*\).*|v\1|p' docs/INSTALL.md | sort -u)"
check "every lore-install --version above section 3.8 of docs/INSTALL.md" "$(paste -sd' ' <<<"$guide_versions")"

[[ "$failed" == 0 ]] && echo "[lore] ${VALUES} pins every image to ${VERSION}"
exit "$failed"
