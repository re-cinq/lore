#!/usr/bin/env bash
# Lint + render the lore-platform umbrella Helm chart (every vendored
# subchart) and assert each subchart contributes resources. A cluster-free
# check for CI and local dev. Two renders:
#   1. defaults      — the chart as checked out; every subchart must emit
#                      resources (# Source: paths use chart NAMES, not dirs)
#   2. deploy flags  — the exact flags the old CI helm deploy
#                      passes on every deploy (keep the two in sync): the
#                      disabled lore-db ownership-reconciler must NOT render
# Regenerate/inspect locally with:
#
#   helm template lore-platform \
#     deploy/chart \
#     --namespace lore-floor --include-crds
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
chart="$repo/deploy/chart"

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

echo "[lore] helm template (deploy flags)"
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

source "$repo/scripts/ci/render-assertions.sh"

fixture="$repo/infra/chart-ci-values/umbrella-full.yaml"
install_values="$(mktemp)"
trap 'rm -f "$install_values"' EXIT
yq '.["lore-platform"]' "$repo/deploy/install/values.yaml" >"$install_values"
lore_namespaces='^(lore-api|lore-ui|lore-stations|lore-dgraph|lore-db)$'
render() { helm template lore-platform "$chart" --namespace lore-floor --include-crds -f "$fixture" "$@"; }
render_installed() { render -f "$install_values" "$@"; }

echo "[lore] render assertions (cloud-neutral fixture)"
neutral="$(render)"
installed="$(render_installed)"

echo "scheduling"
scheduled="$(render --set global.nodeSelector.pool=management \
	--set 'global.tolerations[0].key=pool' --set 'global.tolerations[0].operator=Exists')"
every_workload "$scheduled" "global.nodeSelector and global.tolerations reach every workload" \
	'.pod.nodeSelector.pool == "management" and (.pod.tolerations | length > 0)' "$lore_namespaces"
every_workload "$(render --set global.nodeSelector.pool=management --set lore-api.nodeSelector.pool=own)" \
	"a subchart's own nodeSelector wins over the global one" \
	'.pod.nodeSelector.pool == (if .name == "lore-api" then "own" else "management" end)' '^lore-api$|^lore-ui$'
every_workload "$neutral" "no scheduling rule appears unless one is set" \
	'(.pod | has("nodeSelector") or has("tolerations")) | not' "$lore_namespaces"

echo "service accounts and storage"
every_workload "$neutral" "every workload has a dedicated ServiceAccount, and only the reconciler mounts its token" \
	'(.pod.serviceAccountName // "default") != "default" and (.pod.automountServiceAccountToken == false or .name == "lore-db-ownership-reconciler")' "$lore_namespaces"
service_accounts_exist "$neutral" "$lore_namespaces"
rendered_lacks "$neutral" "no GKE annotation on a ServiceAccount without a Google project" \
	'.kind == "ServiceAccount" and ((.metadata.annotations // {}) | keys | any(startswith("iam.gke.io")))'
rendered_has "$(render --set platform.gcpProject=p --set lore-api.gcpProject=p)" "the GKE annotation returns with platform.gcpProject" \
	'.kind == "ServiceAccount" and .metadata.name == "lore-ui" and (.metadata.annotations | has("iam.gke.io/gcp-service-account"))'
rendered_lacks "$neutral" "Dgraph names no storage class unless asked" \
	'.kind == "StatefulSet" and (.spec.volumeClaimTemplates[0].spec | has("storageClassName"))'
rendered_has "$(render --set platform.dgraph.storageClass=fast)" "Dgraph uses platform.dgraph.storageClass when set" \
	'.kind == "StatefulSet" and .spec.volumeClaimTemplates[0].spec.storageClassName == "fast"'
rendered_lacks "$neutral" "the gcp-cost-sync courier is off without a Google project" \
	'.kind == "CronJob" and (.metadata.name | endswith("gcp-cost-sync"))'
rendered_has "$(render --set lore-stations.gcpProject=p)" "the gcp-cost-sync courier returns with a Google project" \
	'.kind == "CronJob" and (.metadata.name | endswith("gcp-cost-sync"))'

echo "ingress"
rendered_lacks "$neutral" "an ingress needs no cert-manager or external-dns annotation and no class" \
	'.kind == "Ingress" and (((.metadata.annotations // {}) | keys | any(startswith("cert-manager") or startswith("external-dns"))) or (.spec | has("ingressClassName")))'
rendered_has "$(render --set platform.clusterIssuer=issuer --set platform.ingressClassName=traefik --set platform.externalDns=true)" \
	"clusterIssuer, ingressClassName and externalDns are rendered when set" \
	'.kind == "Ingress" and .spec.ingressClassName == "traefik" and .metadata.annotations["cert-manager.io/cluster-issuer"] == "issuer" and (.metadata.annotations | has("external-dns.alpha.kubernetes.io/hostname"))'

echo "pod hardening (a value: off in the chart, on in deploy/install)"
every_workload "$neutral" "by default pods keep today's security context (our own cluster)" \
	'[.pod.containers[] | .securityContext.readOnlyRootFilesystem // false] | any | not' '^(lore-api|lore-ui)$'
every_workload "$installed" "pods run non-root under the RuntimeDefault seccomp profile" \
	'.pod.securityContext.runAsNonRoot == true and .pod.securityContext.seccompProfile.type == "RuntimeDefault"' "$lore_namespaces"
every_workload "$installed" "containers drop every capability, never escalate, and keep a read-only root" \
	'[(.pod.containers + (.pod.initContainers // []))[] | .securityContext.allowPrivilegeEscalation == false and .securityContext.capabilities.drop == ["ALL"]] | all' "$lore_namespaces"
every_workload "$installed" "the long-running workloads keep a read-only root filesystem" \
	'.kind == "Job" or .kind == "CronJob" or ([.pod.containers[] | .securityContext.readOnlyRootFilesystem == true] | all)' "$lore_namespaces"
every_workload "$installed" "no workload mounts a hostPath volume" \
	'[(.pod.volumes // [])[] | has("hostPath")] | any | not' "$lore_namespaces"
every_workload "$neutral" "images are pulled only when absent" \
	'[.pod.containers[] | .imagePullPolicy == "IfNotPresent"] | all' "$lore_namespaces"
every_workload "$neutral" "the Dgraph schema Job needs no package install at start" \
	'[.pod.containers[] | (.args // []) + (.command // []) | map(test("apk add")) | any] | any | not' '^lore-dgraph$'
digest="sha256:$(printf '0%.0s' {1..64})"
every_workload "$(render --set lore-api.image.digest=$digest --set lore-ui.image.digest=$digest \
	--set lore-stations.image.digest=$digest --set lore-mcp-gateway.image.digest=$digest)" \
	"image.digest pins the four application images" \
	'.kind != "Deployment" or (.pod.containers[0].image | endswith("@" + "'"$digest"'"))' '^(lore-api|lore-ui|lore-stations)$'
rendered_lacks "$neutral" "no PodDisruptionBudget on a single replica" '.kind == "PodDisruptionBudget"'
rendered_has "$(render --set lore-api.replicaCount=2)" "a PodDisruptionBudget returns with a second replica" \
	'.kind == "PodDisruptionBudget" and .metadata.name == "lore-api"'

echo "network policies and pod security (opt in)"
rendered_lacks "$neutral" "no NetworkPolicy beyond the agent egress rule by default" \
	'.kind == "NetworkPolicy" and (.metadata.name | endswith("agent-egress") | not)'
rendered_lacks "$neutral" "no Pod Security label by default" \
	'.kind == "Namespace" and ((.metadata.labels // {}) | keys | any(startswith("pod-security")))'
policies="$(render --set platform.networkPolicies.enabled=true --set platform.podSecurity=restricted)"
for namespace in lore-api lore-ui lore-stations lore-dgraph; do
	rendered_has "$policies" "${namespace} is default-deny for ingress" \
		'.kind == "NetworkPolicy" and .metadata.name == "default-deny-ingress" and .metadata.namespace == "'"$namespace"'"'
done
rendered_has "$policies" "the ingress controller namespace reaches lore-api" \
	'.kind == "NetworkPolicy" and .metadata.namespace == "lore-api" and ((.spec.ingress // []) | map(.from[]?.namespaceSelector.matchLabels["kubernetes.io/metadata.name"]) | index("traefik") != null)'
rendered_has "$policies" "lore-api and lore-stations reach Dgraph" \
	'.kind == "NetworkPolicy" and .metadata.namespace == "lore-dgraph" and ([(.spec.ingress // [])[].from[]?.namespaceSelector.matchLabels["kubernetes.io/metadata.name"]] | (index("lore-api") != null and index("lore-stations") != null))'
rendered_has "$policies" "the floor namespace reaches lore-api" \
	'.kind == "NetworkPolicy" and .metadata.namespace == "lore-api" and ([(.spec.ingress // [])[].from[]?.namespaceSelector.matchLabels["kubernetes.io/metadata.name"]] | index("lore-floor") != null)'
rendered_has "$policies" "the monitoring namespace reaches the metrics ports" \
	'.kind == "NetworkPolicy" and .metadata.namespace == "lore-api" and ([(.spec.ingress // [])[] | select(any(.from[]?.namespaceSelector.matchLabels["kubernetes.io/metadata.name"]; . == "monitoring")) | .ports[].port] | index(9464) != null)'
rendered_has "$policies" "the Dgraph namespace enforces the restricted Pod Security profile" \
	'.kind == "Namespace" and .metadata.name == "lore-dgraph" and .metadata.labels["pod-security.kubernetes.io/enforce"] == "restricted"'
every_workload "$(render_installed --set platform.podSecurity=restricted)" \
	"every workload in a restricted namespace satisfies the restricted profile" \
	'.pod.securityContext.runAsNonRoot == true and .pod.securityContext.seccompProfile.type == "RuntimeDefault" and ([(.pod.containers + (.pod.initContainers // []))[] | .securityContext.allowPrivilegeEscalation == false and .securityContext.capabilities.drop == ["ALL"]] | all)' \
	'^(lore-api|lore-ui|lore-stations|lore-dgraph)$'

echo "gateway token"
rendered_has "$neutral" "by default the gateway's inbound bearer is the ingest token (our cluster's behaviour)" \
	'.kind == "Deployment" and .metadata.name == "lore-mcp-gateway" and ([.spec.template.spec.containers[0].env[] | select(.name == "LORE_MCP_AUTH_TOKEN") | .valueFrom.secretKeyRef.name] == ["lore-ingest-token"])'
split="$(render --set lore-mcp-gateway.mcpAuthTokenSecret.name=lore-mcp-auth-token)"
rendered_has "$split" "mcpAuthTokenSecret moves only the inbound bearer to its own Secret" \
	'.kind == "Deployment" and .metadata.name == "lore-mcp-gateway" and ([.spec.template.spec.containers[0].env[] | select(.name == "LORE_MCP_AUTH_TOKEN") | .valueFrom.secretKeyRef.name] == ["lore-mcp-auth-token"]) and ([.spec.template.spec.containers[0].env[] | select(.name == "LORE_INGEST_TOKEN") | .valueFrom.secretKeyRef.name] == ["lore-ingest-token"])'
rendered_has "$installed" "the install gives the gateway its own inbound token" \
	'.kind == "Deployment" and .metadata.name == "lore-mcp-gateway" and ([.spec.template.spec.containers[0].env[] | select(.name == "LORE_MCP_AUTH_TOKEN") | .valueFrom.secretKeyRef.name] == ["lore-mcp-auth-token"])'

echo "the five copies of the shared helpers stay identical"
helpers="$(sha256sum "$chart"/charts/*/templates/_lore.tpl | cut -d' ' -f1 | sort -u | wc -l)"
if [[ "$helpers" == 1 ]]; then render_ok "every subchart's _lore.tpl is the same file"; else render_fail "the subcharts' _lore.tpl files differ"; fi

finish_assertions "lore-platform umbrella render assertions"
echo "lore-platform umbrella renders with every subchart."
