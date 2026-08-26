#!/usr/bin/env bash
# Install a Lore satellite (the standalone cluster-agent chart,
# specs/running-stations-in-any-k8s-cluster) into ANY Kubernetes cluster:
# the cluster registers with the central Lore API, claims station runs whose
# required_tags it covers, and runs them locally. Idempotent
# (helm upgrade --install); re-running is free.
#
# Usage:
#   scripts/install-satellite.sh \
#     --api-url https://lore-api.example.com \
#     --event-router-url https://lore-events.example.com \
#     --registration-token <pre-shared token> \
#     --name gpu-box-1 --tags node:agent,node:validate
#
# Every flag can also come from env: LORE_API_URL, EVENT_ROUTER_URL,
#   LORE_CLUSTER_AGENT_REGISTRATION_TOKEN, LORE_CLUSTER_AGENT_NAME,
#   LORE_CLUSTER_AGENT_TAGS, GHCR_USERNAME, GHCR_TOKEN, and
#   CLAUDE_CODE_OAUTH_TOKEN (bills a subscription) or ANTHROPIC_API_KEY.
# Installs into the CURRENT kubectl context; pass --context to assert which
# one that must be (the install refuses on a mismatch instead of landing a
# satellite in whatever context happened to be active).
set -euo pipefail

say() { echo "[lore] $*"; }
die() {
	echo "[lore] ERROR: $*" >&2
	exit 1
}

expected_context=""
network_policy=true
while [ $# -gt 0 ]; do
	case "$1" in
	--api-url) LORE_API_URL="$2" && shift 2 ;;
	--event-router-url) EVENT_ROUTER_URL="$2" && shift 2 ;;
	--registration-token) LORE_CLUSTER_AGENT_REGISTRATION_TOKEN="$2" && shift 2 ;;
	--name) LORE_CLUSTER_AGENT_NAME="$2" && shift 2 ;;
	--tags) LORE_CLUSTER_AGENT_TAGS="$2" && shift 2 ;;
	--context) expected_context="$2" && shift 2 ;;
	# Local single-node clusters (minikube) have no CNI enforcing policies;
	# the flag keeps the rendered objects out of the way there.
	--no-network-policy) network_policy=false && shift ;;
	*) die "unknown flag: $1 (see the header of this script)" ;;
	esac
done

command -v helm >/dev/null 2>&1 || die "helm is not installed (https://helm.sh/docs/intro/install/)"
command -v kubectl >/dev/null 2>&1 || die "kubectl is not installed"
context="$(kubectl config current-context 2>/dev/null)" || die "no current kubectl context — point kubectl at the target cluster first"

if [ -n "$expected_context" ] && [ "$context" != "$expected_context" ]; then
	die "current kubectl context is '$context', not '$expected_context' — refusing to install a satellite into it"
fi
kubectl version >/dev/null 2>&1 || die "cannot reach the cluster behind context '$context'"

[ -n "${LORE_API_URL:-}" ] || die "LORE_API_URL is not set (the central lore-api base URL)"
[ -n "${EVENT_ROUTER_URL:-}" ] || die "EVENT_ROUTER_URL is not set (the central event-router front door)"
[ -n "${LORE_CLUSTER_AGENT_REGISTRATION_TOKEN:-}" ] || die "LORE_CLUSTER_AGENT_REGISTRATION_TOKEN is not set (ask your platform engineer)"
[ -n "${GHCR_USERNAME:-}" ] || die "GHCR_USERNAME is not set (GHCR pull credentials)"
[ -n "${GHCR_TOKEN:-}" ] || die "GHCR_TOKEN is not set (GHCR pull credentials)"

name="${LORE_CLUSTER_AGENT_NAME:-satellite-$context}"
tags="${LORE_CLUSTER_AGENT_TAGS:-node:agent,node:validate,node:gate,node:retrospective,node:github_action}"

# A laptop bills the developer's subscription when it can (values.minikube
# precedent); an API key is the fallback.
if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
	llm_key="CLAUDE_CODE_OAUTH_TOKEN"
	llm_credential="$CLAUDE_CODE_OAUTH_TOKEN"
elif [ -n "${ANTHROPIC_API_KEY:-}" ]; then
	llm_key="ANTHROPIC_API_KEY"
	llm_credential="$ANTHROPIC_API_KEY"
else
	die "no LLM credential — set CLAUDE_CODE_OAUTH_TOKEN (claude setup-token) or ANTHROPIC_API_KEY"
fi

repo="$(cd "$(dirname "$0")/.." && pwd)"
chart="$repo/infra/terraform/modules/gke-mcp/lore-platform/charts/cluster-agent-standalone-helm"

say "vendoring the ai-agents subchart (helm dependency update)"
helm dependency update "$chart" >/dev/null

# The namespaces may already exist, so apply them outside Helm's ownership
# and skip the chart's.
for ns in lore-cluster-agent ai-agents; do
	kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
done

say "installing release lore-satellite into context '$context' (name=$name tags=$tags llm=$llm_key)"
helm upgrade --install lore-satellite "$chart" \
	--namespace lore-cluster-agent \
	--set createNamespaces=false \
	--set-string loreApiUrl="$LORE_API_URL" \
	--set-string eventRouterUrl="$EVENT_ROUTER_URL" \
	--set-string registrationToken="$LORE_CLUSTER_AGENT_REGISTRATION_TOKEN" \
	--set-string name="$name" \
	--set "tags={$tags}" \
	--set-string ghcr.username="$GHCR_USERNAME" \
	--set-string ghcr.token="$GHCR_TOKEN" \
	--set-string llm.secretKey="$llm_key" \
	--set-string llm.credential="$llm_credential" \
	--set-string ai-agents.agentLlmSecretKey="$llm_key" \
	--set ai-agents.networkPolicy.enabled="$network_policy" \
	--set-string ai-agents.loreApiUrl="$LORE_API_URL"

rm -rf "$chart/charts" "$chart/Chart.lock"

say "satellite installed. Watch it register and claim:"
say "  kubectl -n lore-cluster-agent logs -l app=lore-cluster-agent -f"
say "It appears on the Clusters page of the web UI once the first heartbeat lands."
