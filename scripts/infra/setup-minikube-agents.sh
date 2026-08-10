#!/usr/bin/env bash
set -euo pipefail

# Bootstrap the ai-agent-subsystem (ADR-031) into a laptop minikube, so a host-run
# Floor (`LORE_STATION_BACKEND=k8s npm start`) can execute real Agent CRs locally.
# Idempotent — safe to re-run.
#
# This is the local stand-in for what terraform does on GKE (infra/terraform/ai-agents.tf
# + the ESO ExternalSecrets): there, secrets come from GCP Secret Manager; here they come
# from .env.local. Everything else is the same vendored chart, with values.minikube.yaml
# repointing the run pods' callbacks at the host and dropping the GKE-only egress policy.
#
# Prereqs: minikube, kubectl, helm, and .env.local with GHCR_USER/GHCR_TOKEN +
# CLAUDE_CODE_OAUTH_TOKEN (or ANTHROPIC_API_KEY). `npm run dev-setup` fills those in.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHART_DIR="$ROOT/infra/terraform/modules/gke-mcp/lore-platform/charts/ai-agents-helm"
NAMESPACE="${LORE_AGENTS_NAMESPACE:-ai-agents}"

log() { echo "[lore] $*"; }
fail() { echo "[lore] ERROR: $*" >&2; exit 1; }

# Standalone runs need the creds; `npm start` has already sourced this.
if [ -f "$ROOT/.env.local" ]; then
  set -a; . "$ROOT/.env.local"; set +a
fi

for tool in minikube kubectl helm; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool not found — needed to run the agent subsystem locally"
done

: "${GHCR_USER:?set GHCR_USER in .env.local (a GitHub PAT owner with read:packages)}"
: "${GHCR_TOKEN:?set GHCR_TOKEN in .env.local (a GitHub PAT with read:packages — the ai-agent images are private)}"

# The agent container runs the real `claude` CLI, which authenticates from either
# credential in its environment. A laptop usually has no org API credit, so a personal
# subscription token is the default here and an API key wins when both are set (it is
# the deliberate choice, and it matches GKE). Whichever it is, the SAME key name must
# land in agent-secrets and in the recipes' resources.secrets — the controller renders a
# non-optional secretKeyRef, so a mismatch is not a fallback, it is every run pod stuck
# in CreateContainerConfigError. Deriving both from one variable here is what makes that
# mismatch unrepresentable.
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  LLM_SECRET_KEY="ANTHROPIC_API_KEY"
  LLM_SECRET_VALUE="$ANTHROPIC_API_KEY"
elif [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  LLM_SECRET_KEY="CLAUDE_CODE_OAUTH_TOKEN"
  LLM_SECRET_VALUE="$CLAUDE_CODE_OAUTH_TOKEN"
else
  fail "no agent LLM credential — set CLAUDE_CODE_OAUTH_TOKEN (run: claude setup-token) or ANTHROPIC_API_KEY in .env.local. 'npm run dev-setup' does this for you."
fi
log "Agent LLM credential: $LLM_SECRET_KEY"

# Must match what the host processes present, since the run pods call back to them.
LORE_INGEST_TOKEN="${LORE_INGEST_TOKEN:-lore-local-dev-token}"
LORE_AGENT_INTERNAL_TOKEN="${LORE_AGENT_INTERNAL_TOKEN:-lore-local-agent-token}"

# 1. Cluster up. `minikube status` exits non-zero when stopped/absent.
MINIKUBE_PROFILE="${MINIKUBE_PROFILE:-minikube}"
if ! minikube status -p "$MINIKUBE_PROFILE" >/dev/null 2>&1; then
  log "minikube is not running — starting it"
  minikube start -p "$MINIKUBE_PROFILE" || fail "minikube start failed"
fi

# 1b. Pin to the minikube context. Everything below — and the host Floor's Agent CR
#     dispatch — otherwise follows whatever `kubectl config current-context` happens to
#     be, which on a working laptop is routinely a real GKE cluster: `npm start` would
#     then create this namespace, these secrets and these CRDs THERE and dispatch every
#     local run into production. Flattening the single context into its own file (rather
#     than threading --context through each call) also hands the Floor something it can
#     be pointed at: LORE_KUBECONFIG is a file path, the only override kubeConfigSource()
#     honours — see libs/shared/src/kube-config.ts.
KUBECONFIG_FILE="$ROOT/.lore-kubeconfig-minikube"
kubectl config view --minify --flatten --context="$MINIKUBE_PROFILE" > "$KUBECONFIG_FILE" \
  || fail "no kubeconfig context named '$MINIKUBE_PROFILE' — check 'kubectl config get-contexts'"
chmod 600 "$KUBECONFIG_FILE"
export KUBECONFIG="$KUBECONFIG_FILE"
log "Pinned to the '$MINIKUBE_PROFILE' context — $KUBECONFIG_FILE"

# 2. Namespace. The system label matches terraform's (kubernetes_namespace.ai_agents).
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl label namespace "$NAMESPACE" "agents.re-cinq.com/system=true" --overwrite >/dev/null
log "Namespace $NAMESPACE ready"

# 3. ghcr pull secret. The controller + ai-agent images are PRIVATE ghcr packages.
kubectl -n "$NAMESPACE" create secret docker-registry ghcr-pull-secret \
  --docker-server=ghcr.io \
  --docker-username="$GHCR_USER" \
  --docker-password="$GHCR_TOKEN" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null

# The chart's imagePullSecrets only covers the controller Deployment. Run pods are
# created by the controller under this namespace's DEFAULT ServiceAccount, so without
# the pull secret bound there every run dies ImagePullBackOff/401 (terraform does the
# same via kubernetes_default_service_account.ai_agents).
kubectl -n "$NAMESPACE" patch serviceaccount default \
  -p '{"imagePullSecrets":[{"name":"ghcr-pull-secret"}]}' >/dev/null
log "ghcr-pull-secret applied and bound to the default ServiceAccount"

# 4. agent-secrets. TWO writers: this script (the static baseline) and the Floor
#    (per-task GH_TOKEN_<id8> keys, patched in per run and removed on terminal). A
#    full `apply` would prune the Floor's live tokens mid-run and fail its run pods
#    on their non-optional GH_TOKEN secretKeyRef — so ensure existence, then MERGE
#    only our own keys. This mirrors ESO's creationPolicy/mergePolicy=Merge on GKE.
#
#    agent-events-auth is sent VERBATIM as HTTP header lines by the supervisor, so it
#    must be the whole `Authorization: Bearer <token>` line — a bare token renders no
#    header and the Floor 401s every telemetry event. The controller injects it as a
#    NON-optional secretKeyRef, so the key must exist or every run pod fails
#    CreateContainerConfigError.
kubectl -n "$NAMESPACE" create secret generic agent-secrets \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "$NAMESPACE" patch secret agent-secrets --type merge -p "$(cat <<JSON
{"stringData": {
  "${LLM_SECRET_KEY}": "${LLM_SECRET_VALUE}",
  "LORE_INGEST_TOKEN": "${LORE_INGEST_TOKEN}",
  "LORE_AGENT_INTERNAL_TOKEN": "${LORE_AGENT_INTERNAL_TOKEN}",
  "agent-events-auth": "Authorization: Bearer ${LORE_AGENT_INTERNAL_TOKEN}"
}}
JSON
)" >/dev/null
log "agent-secrets merged ($LLM_SECRET_KEY, LORE_INGEST_TOKEN, LORE_AGENT_INTERNAL_TOKEN, agent-events-auth)"

# 5. CRDs. Helm only installs crds/ on first install, never on upgrade — apply them
#    explicitly so a re-run picks up contract changes.
kubectl apply -f "$CHART_DIR/crds/" >/dev/null
log "Agent/Station/AgentDefinition CRDs applied"

# 6. The subsystem itself.
helm upgrade --install ai-agents "$CHART_DIR" \
  --namespace "$NAMESPACE" \
  -f "$CHART_DIR/values.minikube.yaml" \
  --set-string "agentLlmSecretKey=$LLM_SECRET_KEY" \
  --wait --timeout 5m \
  || fail "helm upgrade failed — check 'kubectl -n $NAMESPACE get pods'"

log "ai-agent-subsystem ready in $NAMESPACE"
log "  controller: kubectl -n $NAMESPACE get deploy"
log "  agent runs: kubectl -n $NAMESPACE get agents -w"
