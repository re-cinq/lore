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
		echo "  UNEXPECTED: $1" >&2
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
require "name: LORE_CLUSTER_AGENT_IDENTITY_SECRET"
require "name: LORE_CLUSTER_AGENT_IDENTITY_NAMESPACE"
require "name: LORE_CLUSTER_AGENT_IDENTITY_KEY"
require "name: LORE_STATION_BACKEND"
# A singleton registrant must never overlap itself on a rollout (token rotation).
require "type: Recreate"
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

# The catalog is not rendered by any chart: this cluster-agent's sync loop
# writes it from lore.agent_definitions. A seeded CR reappearing here would be
# a second writer, the #2010 flap.
refuse "lore-catalog-seed"

# FR5: LORE_INGEST_TOKEN never leaves the central cluster, in any template.
refuse "LORE_INGEST_TOKEN"

# #1575: the http telemetry sink needs a credential this chart never ships, so
# by default the sync gets no events URL and renders no sink. The same default
# holds for MCP and skills: an unset URL omits the block it feeds.
refuse "agent-events-auth"
refuse "name: LORE_AGENT_EVENTS_URL"
refuse "name: LORE_MCP_URL"
refuse "name: LORE_SKILLS_URL"
# What the sync always needs: a declared profile, and the one LLM key this
# chart writes into agent-secrets.
require 'name: LORE_CATALOG_PROFILE'
require 'value: "bare"'
require "name: LORE_AGENT_LLM_SECRET_KEY"

# Each opt-in must reach the cluster-agent's env, or the guard never OPENS —
# the regression #1629 caught for MCP. Rendered with every catalog URL set.
echo "[lore] helm template (telemetry, MCP and skills opted in)"
out="$(helm template lore-satellite "$chart" \
	--namespace lore-cluster-agent --include-crds \
	--set loreApiUrl=https://lore-api.example.com \
	--set eventRouterUrl=https://lore-events.example.com \
	--set registrationToken=dummy-registration-token \
	--set name=render-check \
	--set 'tags={node:agent}' \
	--set ghcr.username=dummy \
	--set ghcr.token=dummy \
	--set llm.credential=dummy \
	--set catalog.eventsUrl=https://lore-agent-events.example.com/api/agent-events \
	--set catalog.mcpUrl=https://lore-mcp.example.com/mcp \
	--set catalog.skillsUrl=https://lore-mcp.example.com/skills)"

require "name: LORE_AGENT_EVENTS_URL"
require "https://lore-agent-events.example.com/api/agent-events"
require "name: LORE_MCP_URL"
require "https://lore-mcp.example.com/mcp"
require "name: LORE_SKILLS_URL"
require "https://lore-mcp.example.com/skills"

if [ "$fail" -ne 0 ]; then
	echo "[lore] cluster-agent-standalone chart render check FAILED" >&2
	exit 1
fi
echo "[lore] cluster-agent-standalone chart renders with all expected resources, no Postgres reference and no seeded catalog."
