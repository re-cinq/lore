#!/usr/bin/env bash
# Render the standalone satellite chart (cluster-agent-standalone-helm, FR6 of
# specs/running-stations-in-any-k8s-cluster) and assert its contract: it
# renders with only the documented required values, fails loudly without
# them, and the rendered manifest contains NO Postgres reference — the
# satellite reaches the world only through loreApiUrl + eventRouterUrl.
# A cluster-free check for CI and local dev, the sibling of
# check-ai-agents-render.sh. Regenerate/inspect locally with the helm
# template invocation below.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
chart="$repo/infra/terraform/modules/gke-mcp/lore-platform/charts/cluster-agent-standalone-helm"

# The ai-agents subchart is a file:// dependency; `helm dependency update`
# vendors it as a tgz under charts/ plus a Chart.lock. Both are generated
# artifacts — remove them on exit so the check is idempotent and leaves the
# tree clean.
cleanup() { rm -rf "$chart/charts" "$chart/Chart.lock"; }
trap cleanup EXIT
echo "[lore] helm dependency update (vendors ../ai-agents-helm)"
helm dependency update "$chart" >/dev/null

echo "[lore] required values must fail the render loudly"
if helm template lore-satellite "$chart" --namespace lore-cluster-agent >/dev/null 2>&1; then
	echo "  UNEXPECTED: chart rendered without the required values" >&2
	exit 1
fi
echo "  ok: render without required values fails"

echo "[lore] helm template (dummy required values)"
out="$(helm template lore-satellite "$chart" \
	--namespace lore-cluster-agent --include-crds \
	--set loreApiUrl=https://lore-api.example.com \
	--set eventRouterUrl=https://lore-events.example.com \
	--set registrationToken=dummy-registration-token \
	--set name=render-check \
	--set 'tags={node:agent,node:validate}' \
	--set ghcr.username=dummy \
	--set ghcr.token=dummy \
	--set llm.credential=dummy)"

fail=0
require() {
	if grep -q -- "$1" <<<"$out"; then
		echo "  ok: $1"
	else
		echo "  MISSING: $1" >&2
		fail=1
	fi
}
# The inverse assertion: the satellite must hold no database credential or
# address, in any form. An absence is not self-documenting, so it is asserted
# rather than left to be noticed — re-adding a Postgres reference here should
# fail CI, not ship.
refuse() {
	if grep -qi -- "$1" <<<"$out"; then
		echo "  UNEXPECTED: $1 (the satellite reaches the world only through loreApiUrl + eventRouterUrl)" >&2
		fail=1
	else
		echo "  ok: absent — $1"
	fi
}

# The chart's own resources.
require "# Source: lore-cluster-agent-standalone/templates/deployment.yaml"
require "name: EVENT_ROUTER_URL"
require "name: LORE_CLUSTER_AGENT_REGISTRATION_TOKEN"
require "name: LORE_CLUSTER_AGENT_NAME"
require "name: LORE_CLUSTER_AGENT_IDENTITY_FILE"
require "name: LORE_STATION_BACKEND"
require 'value: "node:agent,node:validate"'
require "secretName: lore-cluster-agent-identity"
require "name: lore-cluster-agent-identity"
require "name: ghcr-pull-secret"
require "name: agent-secrets"
# The vendored ai-agents subsystem must contribute (CRDs + controller).
require "# Source: lore-cluster-agent-standalone/charts/ai-agents/"
require "kind: CustomResourceDefinition"
require "name: agent-controller"

# FR6 verification: a rendered manifest contains no Postgres reference.
refuse "postgres"
refuse "LORE_DB_HOST"
refuse "DATABASE_URL"
refuse "pgvector"

# FR5: LORE_INGEST_TOKEN never leaves the central cluster. The chart's OWN
# templates must not reference it (the vendored ai-agents catalog seed does,
# for its station recipes, so the assertion is scoped to this chart's docs).
own="$(awk '/^# Source: /{p = ($0 ~ /^# Source: lore-cluster-agent-standalone\/templates\//)} p' <<<"$out")"
if grep -q "LORE_INGEST_TOKEN" <<<"$own"; then
	echo "  UNEXPECTED: LORE_INGEST_TOKEN in the satellite's own templates (FR5: it never leaves the central cluster)" >&2
	fail=1
else
	echo "  ok: absent — LORE_INGEST_TOKEN in the chart's own templates"
fi

if [ "$fail" -ne 0 ]; then
	echo "[lore] cluster-agent-standalone chart render check FAILED" >&2
	exit 1
fi
echo "[lore] cluster-agent-standalone chart renders with all expected resources and no Postgres reference."
