#!/usr/bin/env bash
# Install the standalone satellite chart into the current minikube — the
# acceptance walk of specs/running-stations-in-any-k8s-cluster: laptop
# cluster registers, claims a run, PR appears. The minikube-specific guards
# live here; the install itself is scripts/install-satellite.sh, which works
# against any cluster. Idempotent; re-running is free.
#
# Required env (or flags passed through): LORE_API_URL, EVENT_ROUTER_URL,
#   LORE_CLUSTER_AGENT_REGISTRATION_TOKEN, GHCR_USERNAME, GHCR_TOKEN,
#   and CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY.
# Strongly recommended: LORE_SKILLS_URL (the central lore-mcp gateway's
#   public /skills registry) — without it every Claude-agent node dies at
#   startup ("Settings file not found"); see install-satellite.sh's header.
set -euo pipefail

die() {
	echo "[lore] ERROR: $*" >&2
	exit 1
}

command -v minikube >/dev/null 2>&1 || die "minikube is not installed (https://minikube.sigs.k8s.io/)"
minikube status >/dev/null 2>&1 || die "minikube is not running — start it with: minikube start"

export LORE_CLUSTER_AGENT_NAME="${LORE_CLUSTER_AGENT_NAME:-satellite-minikube}"

exec "$(dirname "$0")/install-satellite.sh" \
	--context minikube \
	--no-network-policy \
	"$@"
