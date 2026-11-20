#!/usr/bin/env bash
# Packages deploy/install (lore-install) with its three dependencies inside the
# archive, and deploy/databases (lore-databases) beside it, and checks both.
# It never pushes. The packaged values name <version> as the tag of each of the
# five images, whatever the committed values say (stamp-image-tags.sh). With
# LORE_IMAGE_DIGESTS set to the table release-images.sh prints, they pin each
# image by digest too. Utopia's chart is read from the git tag of the Utopia
# image the values file pins, or from UTOPIA_CHART_DIR.
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

bash "$REPO/scripts/ci/stamp-image-tags.sh" "$STAGE/deploy/install/values.yaml" "$TAG" >/dev/null

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
for example in values.aks.example.yaml values.gke.example.yaml values.local.example.yaml values.minimal.example.yaml; do
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

rendered_count "$rendered" "cert-manager's HTTP-01 solver is admitted from the ingress namespace wherever an Ingress asks for a certificate" \
  '.kind == "NetworkPolicy" and .metadata.name == "allow-acme-http01-solver" and (.metadata.namespace | test("^lore-(api|ui)$")) and .spec.ingress[0].ports[0].port == 8089' 2
rendered_lacks "$(render --set-string lore-platform.platform.clusterIssuer=)" "no solver rule without a ClusterIssuer" \
  '.kind == "NetworkPolicy" and .metadata.name == "allow-acme-http01-solver"'
rendered_has "$(render --set secrets.githubApp.appId=1234567 --set secrets.githubApp.installationId=87654321)" "an unquoted GitHub App id is written as plain digits" \
  '.kind == "Secret" and .metadata.name == "github-app-credentials" and .metadata.namespace == "lore-api" and .stringData["app-id"] == "1234567" and .stringData["installation-id"] == "87654321"'

echo "[lore] only GitHub is mandatory: the minimal example"
MINIMAL="$WORK/values.minimal.filled.yaml"
sed 's/CHANGE-ME/render-check-value-0123456789abcdef/g' "$REPO/deploy/install/values.minimal.example.yaml" >"$MINIMAL"
render_minimal() { helm template lore "$ARCHIVE" -n lore-floor -f "$MINIMAL" "$@"; }
minimal="$(render_minimal)" || fail "helm template of ${ARCHIVE} with values.minimal.example.yaml failed"
yq -e '.utopia.enabled == false and .["lore-platform"]["lore-api"].utopia.enabled == false' "$REPO/deploy/install/values.yaml" >/dev/null \
  && render_ok "Utopia is off by default" || render_fail "Utopia is on by default"
rendered_lacks "$minimal" "no Utopia object" '(.metadata.name // "") | test("utopia")'
rendered_text_lacks "$minimal" "lore-api is not told where Utopia is" 'UTOPIA_API_URL'
rendered_has "$minimal" "the minimal install turns Cloud Trace off" \
  '.kind == "Deployment" and .metadata.name == "lore-api" and ([.spec.template.spec.containers[0].env[] | select(.name == "LORE_TRACE_EXPORTER") | .value] == ["none"])'
rendered_has "$minimal" "the minimal install does not default to Vertex embeddings" \
  '.kind == "Deployment" and .metadata.name == "lore-api" and ([.spec.template.spec.containers[0].env[] | select(.name == "LORE_EMBEDDING_PROVIDER") | .value] == ["openai"])'
rendered_has "$minimal" "the minimal install turns off Dgraph's usage reports and Sentry" \
  '.kind == "StatefulSet" and .metadata.name == "lore-dgraph-alpha" and ([.spec.template.spec.containers[0].env[] | select(.name | test("TELEMETRY")) | .value] == ["reports=false; sentry=false;", "reports=false; sentry=false;"])'
rendered_lacks "$minimal" "no ExternalSecret" '.kind == "ExternalSecret"'
rendered_lacks "$minimal" "no ServiceAccount annotation names an identity" '.kind == "ServiceAccount" and ((.metadata.annotations // {}) | keys | any(test("iam\\.gke\\.io|azure\\.workload|amazonaws")))'
# No rendered env value, annotation or URL names another provider. Three kinds of
# line are allowed. The optional Slack secretKeyRefs of lore-api and lore-stations:
# env variable and Secret NAMES, marked optional, with no value and no host when
# the Secret is absent; the code posts to Slack only with a bot token.
# The other: the migrate script's error message about an Azure server parameter,
# printed only when creating an extension fails. Dgraph's two TELEMETRY variables,
# whose value is `sentry=false`: they switch Sentry off. The migrate ConfigMaps (SQL that
# creates tables, one of them gcp_cost_daily) are not scanned: they call nothing.
vendor_pattern='googleapis|google|gcp|gserviceaccount|azure|microsoft|slack|vertex|sentry|datadog|segment\.io|amplitude'
allowed_pattern='LORE_SLACK_(SIGNING_SECRET|BOT_TOKEN)|name: lore(-stations)?-slack|On Azure the extension must also be allow-listed|DGRAPH_(ALPHA|ZERO)_TELEMETRY'
scanned="$(yq 'select((.kind == "ConfigMap" and (.metadata.name | test("migrat|baseline"))) | not)' <<<"$minimal")"
vendor_hits="$(grep -inE "$vendor_pattern" <<<"$scanned" | grep -viE '^[0-9]+:\s*#' | grep -vE "$allowed_pattern" || true)"
allowed_count="$(grep -iE "$vendor_pattern" <<<"$scanned" | grep -cE "$allowed_pattern" || true)"
if [[ -z "$vendor_hits" ]]; then
  render_ok "the minimal render names no Google, Azure, Microsoft, Slack, Vertex or Sentry host, value or annotation (${allowed_count} allow-listed lines: optional Slack secretKeyRefs, one migrate error message, Dgraph's telemetry-off variables; migrate ConfigMaps not scanned)"
else
  render_fail "the minimal render names a third party: $(head -5 <<<"$vendor_hits" | paste -sd'|')"
fi

echo "[lore] a Secret of your own instead of a value"
byo="$(render_minimal --set-string secrets.githubApp.appId= --set-string secrets.githubApp.privateKey= --set-string secrets.githubApp.installationId= \
  --set-string secrets.githubOAuth.clientId= --set-string secrets.githubOAuth.clientSecret= --set-string secrets.anthropicApiKey=)" \
  && render_ok "empty credential groups render (helm template cannot read the cluster)" || render_fail "empty credential groups fail an offline render"
rendered_lacks "${byo:-}" "an empty GitHub or model group writes no Secret" \
  '.kind == "Secret" and (.metadata.name | test("github-app|github-oauth|anthropic"))'
partial_error="$(render_minimal --set-string secrets.githubApp.appId= 2>&1 >/dev/null || true)"
grep -q 'secrets.githubApp is set only in part' <<<"$partial_error" && render_ok "a GitHub App set only in part is refused" || render_fail "a partial GitHub App was accepted"
rendered_has "$minimal" "set values write the GitHub Secret, labelled as this chart's" \
  '.kind == "Secret" and .metadata.name == "github-app-credentials" and .metadata.namespace == "lore-api" and .metadata.labels["lore-install.re-cinq.com/managed"] == "true"'
rendered_has "$minimal" "set values write the tokens too" '.kind == "Secret" and .metadata.name == "lore-ingest-token" and .metadata.namespace == "lore-stations"'

echo "[lore] one identity provider block, required only with Utopia"
rendered_lacks "$rendered" "the example's OIDC client lands in utopia-oauth, from secrets.oidc" \
  '.kind == "Secret" and .metadata.name == "utopia-oauth" and (.stringData["client-id"] != "render-check-value-0123456789abcdef" or .stringData["client-secret"] != "render-check-value-0123456789abcdef")'
rendered_has "$rendered" "utopia-oauth is rendered when Utopia is on" '.kind == "Secret" and .metadata.name == "utopia-oauth"'
rendered_lacks "$(render --set-string secrets.oidc.clientId= --set-string secrets.oidc.clientSecret=)" "an empty OIDC client is a Secret of your own" \
  '.kind == "Secret" and .metadata.name == "utopia-oauth"'
issuer_error="$(render_minimal --set utopia.enabled=true --set lore-platform.lore-api.utopia.enabled=true 2>&1 >/dev/null || true)"
grep -q 'global.oidc.issuer is required' <<<"$issuer_error" && render_ok "Utopia without global.oidc.issuer is refused" || render_fail "Utopia was enabled with no issuer"
mismatch_error="$(render --set global.oidc.issuer=https://other.example.com 2>&1 >/dev/null || true)"
grep -q 'must repeat global.oidc' <<<"$mismatch_error" && render_ok "utopia.oidc differing from global.oidc is refused" || render_fail "a utopia.oidc that differs from global.oidc was accepted"
rendered_has "$rendered" "Utopia reads the issuer of the example" \
  '.kind == "Deployment" and .metadata.name == "utopia" and ([.spec.template.spec.containers[0].env[] | select(.name == "UTOPIA_OIDC_ISSUER") | .value] | length == 1)'

for example in gke local minimal; do
  file="deploy/install/values.${example}.example.yaml"
  filled_example="$WORK/values.${example}.filled.yaml"
  sed 's/CHANGE-ME/render-check-value-0123456789abcdef/g' "$REPO/$file" >"$filled_example"
  echo "[lore] assertions on ${file}"
  example_rendered="$(helm template lore "$ARCHIVE" -n lore-floor -f "$filled_example" --set global.nodeSelector.pool=management)" \
    || fail "helm template of ${ARCHIVE} with ${file} failed"
  rendered_lacks "$example_rendered" "no ExternalSecret" '.kind == "ExternalSecret"'
  rendered_text_lacks "$example_rendered" "no ingress controller annotation is needed" 'nginx.ingress.kubernetes.io'
  every_workload "$example_rendered" "global.nodeSelector reaches every workload" '.pod.nodeSelector.pool == "management"'
  if [[ "$example" == local || "$example" == minimal ]]; then
    rendered_lacks "$example_rendered" "a laptop trial or the minimal example has no TLS section on Lore's ingresses" \
      '.kind == "Ingress" and (.metadata.namespace | test("^lore-(api|ui)$")) and (.spec | has("tls"))'
  else
    rendered_has "$example_rendered" "Lore's ingresses carry a TLS section" \
      '.kind == "Ingress" and .metadata.name == "lore-ui" and (.spec | has("tls"))'
  fi
  if [[ "$example" == gke ]]; then
    rendered_has "$example_rendered" "the GKE example binds lore-api's ServiceAccount to its Google service account by annotation" \
      '.kind == "ServiceAccount" and .metadata.name == "lore-api" and (.metadata.annotations | has("iam.gke.io/gcp-service-account"))'
    rendered_has "$example_rendered" "the GKE example turns Utopia on" '.kind == "Deployment" and .metadata.name == "utopia"'
  else
    rendered_lacks "$example_rendered" "only the GKE example carries a Google identity annotation" \
      '.kind == "ServiceAccount" and ((.metadata.annotations // {}) | keys | any(startswith("iam.gke.io")))'
  fi
  [[ "$example" != local && "$example" != minimal ]] || rendered_lacks "$example_rendered" "the ${example} example leaves Utopia off" '(.metadata.name // "") | test("utopia")'
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
list_error="$(render --set-string 'lore-platform.platform.ingresses[0].host=CHANGE-ME.example.com' 2>&1 >/dev/null || true)"
grep -q 'ingresses.0.host still holds the placeholder CHANGE-ME' <<<"$list_error" && render_ok "a placeholder inside a list is refused" || render_fail "a CHANGE-ME ingress host was accepted"
short_error="$(render --set secrets.ingestToken=short 2>&1 >/dev/null || true)"
grep -q 'must be at least 32' <<<"$short_error" && render_ok "a token shorter than 32 characters is refused" || render_fail "a 5 character ingest token was accepted"
finish_assertions "install chart render assertions"
echo "[lore] ${ARCHIVE} holds the three dependencies and renders with ${VALUES_EXAMPLE}; ${DATABASES_ARCHIVE} is packaged"
