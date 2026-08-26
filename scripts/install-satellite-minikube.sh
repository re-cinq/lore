#!/usr/bin/env bash
# Install the standalone satellite chart (cluster-agent-standalone-helm, FR6
# of specs/running-stations-in-any-k8s-cluster) into the current minikube —
# the acceptance walk: laptop cluster registers, claims a run, PR appears.
# Idempotent (helm upgrade --install); re-running is free.
#
# Required env (or flags): LORE_API_URL, EVENT_ROUTER_URL,
#   LORE_CLUSTER_AGENT_REGISTRATION_TOKEN, GHCR_USERNAME, GHCR_TOKEN,
#   and CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY.
# Optional: LORE_CLUSTER_AGENT_NAME (default satellite-minikube),
#   LORE_CLUSTER_AGENT_TAGS (comma-separated; default below).
set -euo pipefail

say() { echo "[lore] $*"; }
die() {
	echo "[lore] ERROR: $*" >&2
	exit 1
}

while [ $# -gt 0 ]; do
	case "$1" in
	--api-url) LORE_API_URL="$2" && shift 2 ;;
	--event-router-url) EVENT_ROUTER_URL="$2" && shift 2 ;;
	--registration-token) LORE_CLUSTER_AGENT_REGISTRATION_TOKEN="$2" && shift 2 ;;
	--name) LORE_CLUSTER_AGENT_NAME="$2" && shift 2 ;;
	--tags) LORE_CLUSTER_AGENT_TAGS="$2" && shift 2 ;;
	*) die "unknown flag: $1 (see the header of this script)" ;;
	esac
done

command -v helm >/dev/null 2>&1 || die "helm is not installed (https://helm.sh/docs/intro/install/)"
command -v kubectl >/dev/null 2>&1 || die "kubectl is not installed"
command -v minikube >/dev/null 2>&1 || die "minikube is not installed (https://minikube.sigs.k8s.io/)"
minikube status >/dev/null 2>&1 || die "minikube is not running — start it with: minikube start"
context="$(kubectl config current-context)"
[ "$context" = "minikube" ] || die "current kubectl context is '$context', not minikube — refusing to install a satellite into it"

[ -n "${LORE_API_URL:-}" ] || die "LORE_API_URL is not set (the central lore-api base URL)"
[ -n "${EVENT_ROUTER_URL:-}" ] || die "EVENT_ROUTER_URL is not set (the central event-router front door)"
[ -n "${LORE_CLUSTER_AGENT_REGISTRATION_TOKEN:-}" ] || die "LORE_CLUSTER_AGENT_REGISTRATION_TOKEN is not set"
[ -n "${GHCR_USERNAME:-}" ] || die "GHCR_USERNAME is not set (GHCR pull credentials)"
[ -n "${GHCR_TOKEN:-}" ] || die "GHCR_TOKEN is not set (GHCR pull credentials)"

name="${LORE_CLUSTER_AGENT_NAME:-satellite-minikube}"
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

# The namespaces may already exist (e.g. setup-minikube-agents.sh created
# ai-agents), so apply them outside Helm's ownership and skip the chart's.
for ns in lore-cluster-agent ai-agents; do
	kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
done

say "installing release lore-satellite (name=$name tags=$tags llm=$llm_key)"
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
	--set ai-agents.networkPolicy.enabled=false \
	--set-string ai-agents.loreApiUrl="$LORE_API_URL"

rm -rf "$chart/charts" "$chart/Chart.lock"

say "satellite installed. Watch it register and claim:"
say "  kubectl -n lore-cluster-agent logs -l app=lore-cluster-agent -f"
