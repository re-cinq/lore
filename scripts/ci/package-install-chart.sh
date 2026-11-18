#!/usr/bin/env bash
# Packages deploy/install (lore-install) with its three dependencies inside the
# archive, and deploy/databases (lore-databases) beside it, and checks both.
# It never pushes. With LORE_IMAGE_DIGESTS set to the table release-images.sh
# prints, the packaged values pin each of the five images by digest too. Utopia's chart is read from
# the git tag of the Utopia image the values file pins, or from UTOPIA_CHART_DIR.
# Usage: package-install-chart.sh <vMAJOR.MINOR.PATCH> <destination dir>
set -euo pipefail

TAG="${1:?version, e.g. v1.0.1}"
DESTINATION="${2:?destination directory}"
VALUES_EXAMPLE="deploy/install/values.aks.example.yaml"
UTOPIA_REPOSITORY="https://github.com/re-cinq/utopia.git"

fail() {
  echo "[lore] $*" >&2
  exit 1
}

[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "'${TAG}' is not vMAJOR.MINOR.PATCH"

VERSION="${TAG#v}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
source "$REPO/scripts/ci/render-assertions.sh"
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

# Writes the digests of the release-images.sh table into a values file. One row
# per image: | image | source tag | `digest` |
pin_image_digests() {
  local values="$1" table="$2" image digest
  declare -A paths=(
    [lore-api]='.["lore-platform"]["lore-api"].image.digest'
    [lore-mcp]='.["lore-platform"]["lore-mcp-gateway"].image.digest'
    [lore-ui]='.["lore-platform"]["lore-ui"].image.digest'
    [lore-stations]='.["lore-platform"]["lore-stations"].image.digest'
    [lore-agent]='.["lore-platform"]["lore-api"].floor.agentImage += "@" + strenv(DIGEST)'
  )
  for image in "${!paths[@]}"; do
    digest="$(awk -F'|' -v image="$image" '$2 ~ "^ *" image " *$" { print $4 }' <<<"$table" | grep -o 'sha256:[0-9a-f]\{64\}' | head -1 || true)"
    [[ -n "$digest" ]] || fail "the image digests have none for ${image}"
    case "$image" in
      lore-agent) DIGEST="$digest" yq -i "${paths[$image]}" "$values" ;;
      *) DIGEST="$digest" yq -i "${paths[$image]} = strenv(DIGEST)" "$values" ;;
    esac
  done
}

if [[ -n "${LORE_IMAGE_DIGESTS:-}" ]]; then
  pin_image_digests "$STAGE/deploy/install/values.yaml" "$LORE_IMAGE_DIGESTS"
fi

echo "[lore] building dependencies"
helm dependency update "$STAGE/deploy/install" >/dev/null

echo "[lore] packaging lore-install ${VERSION}"
helm package "$STAGE/deploy/install" --version "$VERSION" --app-version "$VERSION" --destination "$DESTINATION" >/dev/null

ARCHIVE="$DESTINATION/lore-install-${VERSION}.tgz"
[[ -f "$ARCHIVE" ]] || fail "helm package did not write ${ARCHIVE}"

echo "[lore] packaging lore-databases ${VERSION}"
helm package "$REPO/deploy/databases" --version "$VERSION" --app-version "$VERSION" --destination "$DESTINATION" >/dev/null
DATABASES_ARCHIVE="$DESTINATION/lore-databases-${VERSION}.tgz"
[[ -f "$DATABASES_ARCHIVE" ]] || fail "helm package did not write ${DATABASES_ARCHIVE}"
tar tzf "$DATABASES_ARCHIVE" | grep -qx 'lore-databases/templates/clusters.yaml' || fail "${DATABASES_ARCHIVE} has no clusters template"

listing="$(tar tzf "$ARCHIVE")"
for example in values.aks.example.yaml values.gke.example.yaml values.local.example.yaml; do
  grep -qx "lore-install/${example}" <<<"$listing" || fail "${ARCHIVE} has no ${example}"
done
for dependency in lore-platform floor utopia; do
  grep -Eq -- "^lore-install/charts/${dependency}/Chart.yaml$|^lore-install/charts/${dependency}-[0-9][^/]*\\.tgz$" <<<"$listing" \
    || fail "${ARCHIVE} holds no ${dependency} chart"
done

platform_listing="$listing"
platform_tgz="$(grep -E '^lore-install/charts/lore-platform-[0-9][^/]*\.tgz$' <<<"$listing" || true)"
[[ -z "$platform_tgz" ]] || platform_listing="$(tar xzOf "$ARCHIVE" "$platform_tgz" | tar tzf -)"
grep -Eq -- '(^|/)lore-platform/charts/lore-api/Chart.yaml$' <<<"$platform_listing" \
  || fail "the lore-platform chart inside ${ARCHIVE} holds no lore-api subchart"

FILLED="$WORK/values.filled.yaml"
sed 's/CHANGE-ME/render-check-value-0123456789abcdef/g' "$REPO/$VALUES_EXAMPLE" >"$FILLED"
render() { helm template lore "$ARCHIVE" -n lore-floor -f "$FILLED" "$@"; }

rendered="$(render)" || fail "helm template of ${ARCHIVE} with ${VALUES_EXAMPLE} failed"

echo "[lore] assertions on ${VALUES_EXAMPLE}"
rendered_lacks "$rendered" "a client cluster has no secret store: no ExternalSecret" '.kind == "ExternalSecret"'
rendered_text_lacks "$rendered" "no ingress controller annotation is needed" 'nginx.ingress.kubernetes.io'
rendered_lacks "$rendered" "no separate webhook ingress" '.kind == "Ingress" and (.metadata.name | test("webhook"))'
rendered_count "$rendered" "three hostnames: UI, API and Utopia (the MCP gateway is a fourth)" \
  '.kind == "Ingress" and .metadata.name != "lore-ui-live" and .metadata.name != "lore-mcp"' 3
rendered_lacks "$rendered" "no pull secret unless secrets.ghcr is set" '.kind == "Secret" and .metadata.name == "ghcr-pull-secret"'
rendered_lacks "$rendered" "no Lore workload asks for a pull secret" \
  '.kind == "Deployment" and (.metadata.namespace // "" | test("^lore-(api|ui|stations)$")) and (.spec.template.spec | has("imagePullSecrets"))'
rendered_count "$(render --set secrets.ghcr.username=user --set secrets.ghcr.token=token)" "secrets.ghcr renders the pull secret in each namespace that pulls" \
  '.kind == "Secret" and .metadata.name == "ghcr-pull-secret"' 4
for generated in lore-ingest-token lore-agent-internal-token lore-mcp-auth-token floor-service-token floor-git-credential-token; do
  rendered_has "$rendered" "${generated} is generated when no value is set" \
    '.kind == "Secret" and .metadata.name == "'"$generated"'" and (.stringData.token | length) == 48'
done
rendered_has "$rendered" "Utopia's cookie secret is generated, at 32 characters" \
  '.kind == "Secret" and .metadata.name == "utopia-oauth" and (.stringData["cookie-secret"] | length) == 32'
rendered_has "$rendered" "Utopia's encryption key is generated as 64 hexadecimal characters (32 bytes)" \
  '.kind == "Secret" and .metadata.name == "utopia-app" and (.stringData["secret-key"] | test("^[0-9a-f]{64}$"))'
rendered_has "$rendered" "lore-api waits for the floor's api before it seeds the floor at boot" \
  '.kind == "Deployment" and .metadata.name == "lore-api" and ([.spec.template.spec.initContainers[]?.name] | index("wait-for-floor") != null)'
rendered_has "$rendered" "the gateway reads its own inbound token" \
  '.kind == "Deployment" and .metadata.name == "lore-mcp-gateway" and ([.spec.template.spec.containers[0].env[] | select(.name == "LORE_MCP_AUTH_TOKEN") | .valueFrom.secretKeyRef.name] == ["lore-mcp-auth-token"])'
pooled="$(render --set global.nodeSelector.pool=management)"
every_workload "$pooled" "global.nodeSelector reaches every Deployment, StatefulSet, CronJob and Job of the three charts" \
  '.pod.nodeSelector.pool == "management"'
rendered_lacks "$pooled" "global.nodeSelector reaches every CloudNativePG Cluster" \
  '.kind == "Cluster" and .spec.affinity.nodeSelector.pool != "management"'
rendered_has "$pooled" "the bundled charts render a CloudNativePG Cluster to check" '.kind == "Cluster"'
for namespace in lore-api lore-ui lore-stations lore-dgraph; do
  rendered_has "$rendered" "${namespace} is default-deny for ingress" \
    '.kind == "NetworkPolicy" and .metadata.name == "default-deny-ingress" and .metadata.namespace == "'"$namespace"'"'
done

for example in gke local; do
  file="deploy/install/values.${example}.example.yaml"
  filled_example="$WORK/values.${example}.filled.yaml"
  sed 's/CHANGE-ME/render-check-value-0123456789abcdef/g' "$REPO/$file" >"$filled_example"
  echo "[lore] assertions on ${file}"
  example_rendered="$(helm template lore "$ARCHIVE" -n lore-floor -f "$filled_example" --set global.nodeSelector.pool=management)" \
    || fail "helm template of ${ARCHIVE} with ${file} failed"
  rendered_lacks "$example_rendered" "no ExternalSecret" '.kind == "ExternalSecret"'
  rendered_text_lacks "$example_rendered" "no ingress controller annotation is needed" 'nginx.ingress.kubernetes.io'
  every_workload "$example_rendered" "global.nodeSelector reaches every workload" '.pod.nodeSelector.pool == "management"'
  if [[ "$example" == local ]]; then
    rendered_lacks "$example_rendered" "a laptop trial has no TLS section on Lore's ingresses" \
      '.kind == "Ingress" and (.metadata.namespace | test("^lore-(api|ui)$")) and (.spec | has("tls"))'
  else
    rendered_has "$example_rendered" "Lore's ingresses carry a TLS section" \
      '.kind == "Ingress" and .metadata.name == "lore-ui" and (.spec | has("tls"))'
  fi
  raw_example_error="$(helm template lore "$ARCHIVE" -n lore-floor -f "$REPO/$file" 2>&1 >/dev/null || true)"
  grep -q 'CHANGE-ME' <<<"$raw_example_error" && render_ok "the unedited ${file} is refused" || render_fail "the unedited ${file} was not refused"
done

echo "[lore] the packaged values pin the images by digest when the release gives them"
fake_digest="sha256:$(printf 'a%.0s' {1..64})"
fake_table=""
for image in lore-api lore-mcp lore-ui lore-stations lore-agent; do
  fake_table+="| ${image} | abc1234 | \`${fake_digest}\` |"$'\n'
done
pinned_values="$WORK/pinned.yaml"
cp "$REPO/deploy/install/values.yaml" "$pinned_values"
pin_image_digests "$pinned_values" "$fake_table"
rendered_pinned="$(helm template lore "$ARCHIVE" -n lore-floor -f "$pinned_values" -f "$FILLED")"
every_workload "$rendered_pinned" "the four application images and no other carry the digest" \
  '.kind != "Deployment" or (.pod.containers[0].image | endswith("@'"$fake_digest"'"))' '^(lore-api|lore-ui|lore-stations)$'
yq -e '.["lore-platform"]["lore-api"].floor.agentImage | contains("@'"$fake_digest"'")' "$pinned_values" >/dev/null \
  && render_ok "the agent image is pinned by digest" || render_fail "the agent image was not pinned"

echo "[lore] the install stops on a placeholder and on a short token"
raw_error="$(helm template lore "$ARCHIVE" -n lore-floor -f "$REPO/$VALUES_EXAMPLE" 2>&1 >/dev/null || true)"
grep -q 'CHANGE-ME' <<<"$raw_error" && render_ok "an example with CHANGE-ME left in it is refused" || render_fail "the unedited ${VALUES_EXAMPLE} was not refused"
short_error="$(render --set secrets.ingestToken=short 2>&1 >/dev/null || true)"
grep -q 'must be at least 32' <<<"$short_error" && render_ok "a token shorter than 32 characters is refused" || render_fail "a 5 character ingest token was accepted"
finish_assertions "install chart render assertions"
echo "[lore] ${ARCHIVE} holds the three dependencies and renders with ${VALUES_EXAMPLE}; ${DATABASES_ARCHIVE} is packaged"
