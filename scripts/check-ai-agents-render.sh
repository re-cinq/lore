#!/usr/bin/env bash
# Render the ai-agents Helm chart and assert the expected resources are present.
# A lightweight, cluster-free check (the infra equivalent of a unit test) for CI
# and local dev. Regenerate/inspect locally with:
#
#   helm template ai-agents \
#     infra/terraform/modules/gke-mcp/lore-platform/charts/ai-agents-helm \
#     --namespace ai-agents --include-crds
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
chart="$repo/infra/terraform/modules/gke-mcp/lore-platform/charts/ai-agents-helm"

out="$(helm template ai-agents "$chart" --namespace ai-agents --include-crds)"

fail=0
require() {
	if grep -q -- "$1" <<<"$out"; then
		echo "  ok: $1"
	else
		echo "  MISSING: $1" >&2
		fail=1
	fi
}

# The inverse assertion. Since ADR-024 (2026-08-24) neither the Floor nor
# lore-api may hold Kubernetes permissions — the cluster agent is the only
# caller. An absence is not self-documenting, so it is asserted rather than
# left to be noticed: re-adding a binding here should fail CI, not ship.
refuse() {
	if grep -q -- "$1" <<<"$out"; then
		echo "  UNEXPECTED: $1 (see ADR-024: only the cluster agent may act on this namespace)" >&2
		fail=1
	else
		echo "  ok: absent — $1"
	fi
}

# CRDs (installed cluster-wide before the namespaced resources)
require "kind: CustomResourceDefinition"
# Controller + its SA/RBAC
require "name: agent-controller"
require "ai-agent-controller@sha256"
# The Floor's and lore-api's cross-namespace RBAC is GONE (ADR-024). The cluster
# agent carries the only binding, in its own subchart — so what this chart must
# now prove is the absence.
refuse "name: agent-launcher"
refuse "name: lore-floor-agent-launcher"
refuse "name: agent-secret-writer"
refuse "name: lore-api-catalog-writer"
# Run-pod egress NetworkPolicy must block the metadata endpoint / RFC1918
require "name: agent-job-egress"
require "169.254.0.0/16"

if [ "$fail" -ne 0 ]; then
	echo "ai-agents chart render check FAILED" >&2
	exit 1
fi
echo "ai-agents chart renders with all expected resources."
