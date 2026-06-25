#!/usr/bin/env bash
# Render the ai-agents Helm chart and assert the expected resources are present.
# A lightweight, cluster-free check (the infra equivalent of a unit test) for CI
# and local dev. Regenerate/inspect locally with:
#
#   helm template ai-agents infra/terraform/modules/gke-mcp/ai-agents-helm \
#     --namespace ai-agents --include-crds
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
chart="$repo/infra/terraform/modules/gke-mcp/ai-agents-helm"

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

# CRDs (installed cluster-wide before the namespaced resources)
require "kind: CustomResourceDefinition"
# Controller + its SA/RBAC
require "name: agent-controller"
require "ai-agent-controller@sha256"
# Caller role + the cross-namespace Floor bindings
require "name: agent-launcher"
require "name: lore-floor-agent-launcher"
# The narrow per-task-token secret writer (scoped by resourceNames)
require "name: agent-secret-writer"
# Run-pod egress NetworkPolicy must block the metadata endpoint / RFC1918
require "name: agent-job-egress"
require "169.254.0.0/16"

if [ "$fail" -ne 0 ]; then
	echo "ai-agents chart render check FAILED" >&2
	exit 1
fi
echo "ai-agents chart renders with all expected resources."
