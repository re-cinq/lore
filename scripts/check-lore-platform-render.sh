#!/usr/bin/env bash
# Lint + render the lore-platform umbrella Helm chart (all five vendored
# subcharts) and assert each subchart contributes resources. A cluster-free
# check for CI and local dev — the umbrella-level sibling of
# check-ai-agents-render.sh. Two renders:
#   1. defaults      — the chart as checked out; every subchart must emit
#                      resources (# Source: paths use chart NAMES, not dirs)
#   2. deploy flags  — the exact flags scripts/ci/deploy-lore-platform.sh
#                      passes on every deploy (this one disables the lore-db
#                      ownership-reconciler, so only the exit code is asserted)
# Regenerate/inspect locally with:
#
#   helm template lore-platform \
#     infra/terraform/modules/gke-mcp/lore-platform \
#     --namespace lore-floor --include-crds
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
chart="$repo/infra/terraform/modules/gke-mcp/lore-platform"

echo "[lore] helm lint (umbrella + subcharts)"
helm lint --with-subcharts "$chart"

echo "[lore] helm template (chart defaults)"
out="$(helm template lore-platform "$chart" --namespace lore-floor --include-crds)"

fail=0
require() {
	if grep -q -- "$1" <<<"$out"; then
		echo "  ok: $1"
	else
		echo "  MISSING: $1" >&2
		fail=1
	fi
}

# Every vendored subchart must contribute at least one rendered resource.
require "# Source: lore-platform/charts/lore-floor/"
require "# Source: lore-platform/charts/lore-api/"
require "# Source: lore-platform/charts/lore-ui/"
require "# Source: lore-platform/charts/lore-db-helm/"
require "# Source: lore-platform/charts/ai-agents/"
# The ui-helm pre-install/pre-upgrade migrations hook must survive.
require "# Source: lore-platform/charts/lore-ui/templates/migrate-job.yaml"

if [ "$fail" -ne 0 ]; then
	echo "lore-platform umbrella render check FAILED" >&2
	exit 1
fi

echo "[lore] helm template (deploy-lore-platform.sh flags)"
helm template lore-platform "$chart" \
	--namespace lore-floor --include-crds \
	--set-file lore-floor.taskTypesConfig="$repo/scripts/task-types.yaml" \
	--set-file lore-api.taskTypesConfig="$repo/scripts/task-types.yaml" \
	--set lore-db-helm.ownershipReconciler.enabled=false >/dev/null

echo "lore-platform umbrella renders with all five subcharts."
