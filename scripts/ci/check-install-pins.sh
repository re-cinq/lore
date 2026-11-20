#!/usr/bin/env bash
# Fails unless the packaged lore-install archive pins all five Lore images to
# <version>, so a release tag can never publish an install chart that points
# elsewhere. It reads the archive only: no checkout, no committed values file.
# Usage: check-install-pins.sh <vMAJOR.MINOR.PATCH> <lore-install-X.Y.Z.tgz>
set -euo pipefail

VERSION="${1:?version, e.g. v1.0.0}"
ARCHIVE="${2:?lore-install archive}"
PLATFORM='.["lore-platform"]'

[[ -f "$ARCHIVE" ]] || {
  echo "[lore] ${ARCHIVE} is not a file" >&2
  exit 1
}
values="$(tar xzOf "$ARCHIVE" lore-install/values.yaml)"

failed=0
check() {
  local name="$1" actual="$2"
  if [[ "$actual" != "$VERSION" ]]; then
    echo "[lore] ${name} is pinned to '${actual}', not ${VERSION}" >&2
    failed=1
  fi
}

check lore-api "$(yq "${PLATFORM}.\"lore-api\".image.tag" <<<"$values")"
check lore-mcp "$(yq "${PLATFORM}.\"lore-mcp-gateway\".image.tag" <<<"$values")"
check lore-ui "$(yq "${PLATFORM}.\"lore-ui\".image.tag" <<<"$values")"
check lore-stations "$(yq "${PLATFORM}.\"lore-stations\".image.tag" <<<"$values")"
check lore-agent "$(yq "${PLATFORM}.\"lore-api\".floor.agentImage | sub(\"@.*\$\"; \"\") | sub(\"^.*:\"; \"\")" <<<"$values")"

[[ "$failed" == 0 ]] && echo "[lore] ${ARCHIVE} pins every image to ${VERSION}"
exit "$failed"
