#!/usr/bin/env bash
# Packages deploy/install (lore-install) with its three dependencies inside the
# archive and checks the archive. It never pushes. Utopia's chart is read from
# the git tag of the Utopia image the values file pins, or from UTOPIA_CHART_DIR.
# Usage: package-install-chart.sh <vMAJOR.MINOR.PATCH> <destination dir>
set -euo pipefail

TAG="${1:?version, e.g. v1.0.1}"
DESTINATION="${2:?destination directory}"
VALUES_EXAMPLE="deploy/install/values.azure.example.yaml"
UTOPIA_REPOSITORY="https://github.com/re-cinq/utopia.git"

fail() {
  echo "[lore] $*" >&2
  exit 1
}

[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "'${TAG}' is not vMAJOR.MINOR.PATCH"

VERSION="${TAG#v}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$DESTINATION"
DESTINATION="$(cd "$DESTINATION" && pwd)"

if [[ -n "${UTOPIA_CHART_DIR:-}" ]]; then
  UTOPIA_CHART="$UTOPIA_CHART_DIR"
else
  utopia_tag="$(yq '.utopia.image.tag' "$REPO/deploy/install/values.yaml")"
  echo "[lore] fetching Utopia chart at v${utopia_tag}"
  git clone --quiet --depth 1 --branch "v${utopia_tag}" "$UTOPIA_REPOSITORY" "$WORK/utopia-src" \
    || fail "re-cinq/utopia has no tag v${utopia_tag}, the Utopia image deploy/install/values.yaml pins"
  UTOPIA_CHART="$WORK/utopia-src/deploy/chart"
fi
[[ -f "$UTOPIA_CHART/Chart.yaml" ]] || fail "no Utopia chart at ${UTOPIA_CHART}"

# The dependencies of deploy/install are file:// paths relative to it, so the
# three charts are laid out in a scratch tree where those paths resolve.
STAGE="$WORK/lore"
mkdir -p "$STAGE/deploy" "$WORK/utopia/deploy"
cp -R "$REPO/deploy/install" "$REPO/deploy/chart" "$STAGE/deploy/"
cp -R "$UTOPIA_CHART" "$WORK/utopia/deploy/chart"

echo "[lore] building dependencies"
helm dependency update "$STAGE/deploy/install" >/dev/null

echo "[lore] packaging lore-install ${VERSION}"
helm package "$STAGE/deploy/install" --version "$VERSION" --app-version "$VERSION" --destination "$DESTINATION" >/dev/null

ARCHIVE="$DESTINATION/lore-install-${VERSION}.tgz"
[[ -f "$ARCHIVE" ]] || fail "helm package did not write ${ARCHIVE}"

listing="$(tar tzf "$ARCHIVE")"
grep -qx 'lore-install/values.azure.example.yaml' <<<"$listing" || fail "${ARCHIVE} has no values.azure.example.yaml"
for dependency in lore-platform floor utopia; do
  grep -Eq -- "^lore-install/charts/${dependency}/Chart.yaml$|^lore-install/charts/${dependency}-[0-9][^/]*\\.tgz$" <<<"$listing" \
    || fail "${ARCHIVE} holds no ${dependency} chart"
done

platform_listing="$listing"
platform_tgz="$(grep -E '^lore-install/charts/lore-platform-[0-9][^/]*\.tgz$' <<<"$listing" || true)"
[[ -z "$platform_tgz" ]] || platform_listing="$(tar xzOf "$ARCHIVE" "$platform_tgz" | tar tzf -)"
grep -Eq -- '(^|/)lore-platform/charts/lore-api/Chart.yaml$' <<<"$platform_listing" \
  || fail "the lore-platform chart inside ${ARCHIVE} holds no lore-api subchart"

rendered="$(helm template lore "$ARCHIVE" -n lore-floor -f "$REPO/$VALUES_EXAMPLE")" \
  || fail "helm template of ${ARCHIVE} with ${VALUES_EXAMPLE} failed"
# A client cluster has no secret store: the chart renders every Secret itself.
! grep -q '^kind: ExternalSecret$' <<<"$rendered" \
  || fail "${ARCHIVE} renders an ExternalSecret with ${VALUES_EXAMPLE}"

echo "[lore] ${ARCHIVE} holds the three dependencies and renders with ${VALUES_EXAMPLE}"
