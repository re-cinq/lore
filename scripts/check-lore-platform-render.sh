#!/usr/bin/env bash
# Lint + render the lore-platform umbrella Helm chart (every vendored
# subchart) and assert each subchart contributes resources. A cluster-free
# check for CI and local dev. Two renders:
#   1. defaults      — the chart as checked out; every subchart must emit
#                      resources (# Source: paths use chart NAMES, not dirs)
#   2. deploy flags  — the exact flags scripts/ci/deploy-lore-platform.sh
#                      passes on every deploy (keep the two in sync): the
#                      disabled lore-db ownership-reconciler must NOT render
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
require "# Source: lore-platform/charts/lore-api/"
require "# Source: lore-platform/charts/lore-ui/"
require "# Source: lore-platform/charts/lore-db-helm/"
# The ui-helm pre-install/pre-upgrade migrations hook must survive, and it
# must always resolve inside helm's 5m deadline — a hook still InProgress at
# the deadline wedged every later umbrella deploy (#1650).
require "# Source: lore-platform/charts/lore-ui/templates/migrate-job.yaml"
require "activeDeadlineSeconds: 270"
require "backoffLimit: 0"

if [ "$fail" -ne 0 ]; then
	echo "lore-platform umbrella render check FAILED" >&2
	exit 1
fi

echo "[lore] helm template (deploy-lore-platform.sh flags)"
deploy_out="$(helm template lore-platform "$chart" \
	--namespace lore-floor --include-crds \
	--set lore-db-helm.ownershipReconciler.enabled=false)"

if grep -q "lore-db-ownership-reconciler" <<<"$deploy_out"; then
	echo "  UNEXPECTED: ownership-reconciler rendered despite enabled=false" >&2
	fail=1
else
	echo "  ok: ownership-reconciler absent when disabled"
fi

if [ "$fail" -ne 0 ]; then
	echo "lore-platform umbrella render check FAILED" >&2
	exit 1
fi
echo "lore-platform umbrella renders with every subchart."
