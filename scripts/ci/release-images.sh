#!/usr/bin/env bash
# Gives every Lore image the version tag of a release. No image is rebuilt: the
# tag is added to the exact manifest the cluster values file says our own
# cluster runs, so a release is what was already running. The cluster runs the
# private builds of this repository (ghcr.io/re-cinq/lore-security-*); the
# version tag goes on the public image of the same service, so nothing built
# here is public before its release.
#
# Usage: release-images.sh <vMAJOR.MINOR.PATCH> [--dry-run | --verify]
#   --dry-run  print source tag, version and digest per image, change nothing
#   --verify   check every <image>:<version> has the digest of its source tag
# Run from a checkout of the tagged commit. Pushing needs a docker login to
# ghcr.io that reads the private packages and writes the public ones.
set -euo pipefail

VERSION="${1:-}"
MODE="${2:-release}"
VALUES="${VALUES:-deploy/clusters/internal-cluster.values.yaml}"
REGISTRY="ghcr.io/re-cinq"

[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "[lore] version must look like v1.2.3, got '${VERSION}'" >&2
  exit 1
}
case "$MODE" in
  release | --dry-run | --verify) ;;
  *) echo "[lore] unknown option '${MODE}'" >&2; exit 1 ;;
esac

# image name -> yq expression of the value that records its tag
declare -A SOURCE_PATHS=(
  [lore-api]='.["lore-api"].image.tag'
  [lore-mcp]='.["lore-mcp-gateway"].image.tag'
  [lore-ui]='.["lore-ui"].image.tag'
  [lore-stations]='.["lore-stations"].image.tag'
  [lore-agent]='.["lore-api"].floor.agentImage | sub("^.*:"; "")'
)
# image name -> yq expression of the repository the cluster pulls it from
declare -A SOURCE_REPOS=(
  [lore-api]='.["lore-api"].image.repository'
  [lore-mcp]='.["lore-mcp-gateway"].image.repository'
  [lore-ui]='.["lore-ui"].image.repository'
  [lore-stations]='.["lore-stations"].image.repository'
  [lore-agent]='.["lore-api"].floor.agentImage | sub(":[^:]*$"; "")'
)
IMAGES=(lore-api lore-mcp lore-ui lore-stations lore-agent)

digest_of() {
  docker buildx imagetools inspect "$1" --format '{{.Manifest.Digest}}' 2>/dev/null || true
}

SUMMARY=$'| Image | Source tag | Digest |\n| --- | --- | --- |'
failed=0
for image in "${IMAGES[@]}"; do
  source_tag=$(yq "${SOURCE_PATHS[$image]}" "$VALUES")
  if [[ -z "$source_tag" || "$source_tag" == null ]]; then
    echo "[lore] ${image}: no tag recorded in ${VALUES}" >&2
    failed=1
    continue
  fi
  source_repo=$(yq "${SOURCE_REPOS[$image]}" "$VALUES")
  source_ref="${source_repo}:${source_tag}"
  version_ref="${REGISTRY}/${image}:${VERSION}"
  source_digest=$(digest_of "$source_ref")
  if [[ -z "$source_digest" ]]; then
    echo "[lore] ${image}: source image ${source_ref} does not exist" >&2
    failed=1
    continue
  fi
  version_digest=$(digest_of "$version_ref")

  if [[ "$MODE" == --dry-run ]]; then
    echo "[lore] ${image}: ${source_ref} -> ${version_ref} (${source_digest})"
  elif [[ "$MODE" == --verify ]]; then
    if [[ "$version_digest" != "$source_digest" ]]; then
      echo "[lore] ${image}: ${VERSION} is '${version_digest:-missing}', expected ${source_digest}" >&2
      failed=1
      continue
    fi
    echo "[lore] ${image}: ${VERSION} is ${source_digest}"
  elif [[ -n "$version_digest" && "$version_digest" != "$source_digest" ]]; then
    echo "[lore] ${image}: ${VERSION} already exists at ${version_digest}, not ${source_digest}; a version is never moved" >&2
    failed=1
    continue
  elif [[ -n "$version_digest" ]]; then
    echo "[lore] ${image}: ${VERSION} already tags ${source_digest}"
  else
    docker buildx imagetools create -t "$version_ref" "${source_repo}@${source_digest}"
    echo "[lore] ${image}: tagged ${source_ref} as ${version_ref} (${source_digest})"
  fi
  SUMMARY+=$'\n'"| ${image} | ${source_tag} | \`${source_digest}\` |"
done

echo
echo "[lore] ${VERSION}"
echo "$SUMMARY"
if [[ "$MODE" != --verify && -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf '### Lore %s\n\n%s\n' "$VERSION" "$SUMMARY" >> "$GITHUB_STEP_SUMMARY"
fi
exit "$failed"
