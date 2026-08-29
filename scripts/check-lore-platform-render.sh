#!/usr/bin/env bash
# Lint + render the lore-platform umbrella Helm chart (all five vendored
# subcharts) and assert each subchart contributes resources. A cluster-free
# check for CI and local dev — the umbrella-level sibling of
# check-ai-agents-render.sh. Two renders:
#   1. defaults      — the chart as checked out; every subchart must emit
#                      resources (# Source: paths use chart NAMES, not dirs)
#   2. deploy flags  — the exact flags scripts/ci/deploy-lore-platform.sh
#                      passes on every deploy (keep the two in sync): the
#                      --set-file task-types content must reach the rendered
#                      ConfigMaps and the disabled lore-db ownership-reconciler
#                      must NOT render
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
deploy_out="$(helm template lore-platform "$chart" \
	--namespace lore-floor --include-crds \
	--set-file lore-floor.taskTypesConfig="$repo/scripts/task-types.yaml" \
	--set-file lore-api.taskTypesConfig="$repo/scripts/task-types.yaml" \
	--set lore-db-helm.ownershipReconciler.enabled=false)"

# --set-file silently sets keys nothing reads (the templates default it to "").
# Assert the task-types content actually landed in each consuming ConfigMap —
# a chart-side rename of the values key would otherwise deploy them empty
# (the 2026-07-17 frozen-ConfigMap incident class). Scoped per document: the
# ai-agents catalog also mentions task-type names, so a render-wide grep
# would false-positive.
config_map_doc() {
	awk -v src="# Source: lore-platform/charts/$1/templates/configmap.yaml" \
		'$0 == src {p=1; next} /^# Source: /{p=0} p' <<<"$deploy_out"
}
for sub in lore-floor lore-api; do
	# Capture first: piping into grep -q would SIGPIPE awk mid-stream and
	# pipefail would report the successful match as a failure.
	doc="$(config_map_doc "$sub")"
	if grep -q "feature-request" <<<"$doc"; then
		echo "  ok: task-types content reaches the $sub ConfigMap"
	else
		echo "  MISSING: task-types content in the $sub ConfigMap (values key drift?)" >&2
		fail=1
	fi
done
# The registration token must be a HARD requirement on both ends. It was
# `optional: true` on each while registration was a feature gate; now that every
# cluster-agent registers, an optional ref means a pod that boots without the
# token and then claims nothing — silently, which is the failure mode the whole
# change exists to remove. Scoped per document: lore-api legitimately marks other
# refs optional, so a render-wide grep would false-positive.
deployment_doc() {
	awk -v src="# Source: lore-platform/charts/$1/templates/deployment.yaml" \
		'$0 == src {p=1; next} /^# Source: /{p=0} p' <<<"$deploy_out"
}
for sub in lore-cluster-agent lore-api; do
	doc="$(deployment_doc "$sub")"
	token_ref="$(grep -A5 "name: LORE_CLUSTER_AGENT_REGISTRATION_TOKEN" <<<"$doc" || true)"
	if [ -z "$token_ref" ]; then
		echo "  MISSING: $sub does not mount LORE_CLUSTER_AGENT_REGISTRATION_TOKEN" >&2
		fail=1
	elif grep -q "optional: true" <<<"$token_ref"; then
		echo "  UNEXPECTED: $sub mounts the registration token as optional" >&2
		fail=1
	else
		echo "  ok: $sub requires the registration token"
	fi
done

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
echo "lore-platform umbrella renders with all five subcharts."
