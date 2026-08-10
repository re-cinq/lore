#!/usr/bin/env bash
set -euo pipefail

# One-time developer bootstrap: check the toolchain, then fill the gaps in
# .env.local. Interactive by design — it prompts for credentials a machine cannot
# invent. Idempotent: an already-set variable is reported and left alone, so
# re-running after adding one tool or one token costs nothing.
#
# Deliberately touches NOTHING outside this machine. Cluster bootstrap stays in
# `npm start` (scripts/dev-local.sh → setup-minikube-agents.sh), which is
# unattended and re-runnable; keeping the interactive half separate is what lets
# the other half stay that way.
#
#   npm run dev-setup   # then: npm start

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.local"

log() { echo "[lore] $*"; }
fail() { echo "[lore] ERROR: $*" >&2; exit 1; }

# ---------------------------------------------------------------- tooling

# Report EVERY missing tool at once. One-at-a-time discovery turns a five-minute
# setup into five install-rerun cycles.
missing=()
check_tool() { command -v "$1" >/dev/null 2>&1 || missing+=("$1 — $2"); }

check_tool docker "https://docs.docker.com/engine/install/"
check_tool minikube "https://minikube.sigs.k8s.io/docs/start/"
check_tool kubectl "https://kubernetes.io/docs/tasks/tools/"
check_tool helm "https://helm.sh/docs/intro/install/"
check_tool claude "https://claude.com/claude-code"

if ! docker compose version >/dev/null 2>&1; then
  missing+=("docker compose v2 — https://docs.docker.com/compose/install/")
fi

if [ ${#missing[@]} -gt 0 ]; then
  log "Missing tools:"
  printf '         %s\n' "${missing[@]}"
  fail "install the above, then re-run: npm run dev-setup"
fi
log "Tools: docker, docker compose, minikube, kubectl, helm, claude — all present"

# ---------------------------------------------------------------- .env.local

if [ ! -f "$ENV_FILE" ]; then
  cp "$ROOT/.env.local.example" "$ENV_FILE"
  log "Created .env.local from .env.local.example"
fi

# A variable counts as set only with a non-empty value: .env.local.example ships
# bare `NAME=` lines, and treating those as configured would skip every prompt on
# a fresh copy.
env_value() {
  sed -n "s/^${1}=\(.*\)$/\1/p" "$ENV_FILE" | tail -1
}

# Replace the existing assignment (commented or not) or append. Values go through
# a temp file — a `sed -i` with a token containing `/` or `&` would corrupt it.
set_env() {
  local name="$1" value="$2" tmp
  tmp="$(mktemp)"
  grep -vE "^#? *${name}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$name" "$value" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
  chmod 600 "$ENV_FILE"
}

# Prompt only for what is missing. `read -s` keeps secrets off the terminal and
# out of scrollback; an empty answer leaves the variable unset rather than writing
# an empty value that later reads as "configured".
prompt_secret() {
  local name="$1" hint="$2" value
  if [ -n "$(env_value "$name")" ]; then
    log "$name — already set, skipping"
    return 0
  fi
  log "$name missing. $hint"
  read -r -s -p "       $name: " value
  echo
  [ -n "$value" ] || { log "$name left unset — re-run when you have it"; return 0; }
  set_env "$name" "$value"
  log "$name saved to .env.local"
}

log "Filling gaps in .env.local (existing values are never overwritten)"

# The agent pods' LLM credential. A subscription token is the laptop default: it
# needs no org API credit. setup-minikube-agents.sh reads whichever of the two is
# present and wires that key name through agent-secrets AND the recipes.
if [ -n "$(env_value CLAUDE_CODE_OAUTH_TOKEN)" ] || [ -n "$(env_value ANTHROPIC_API_KEY)" ]; then
  log "Agent LLM credential — already set, skipping"
else
  log "No agent LLM credential yet. Running \`claude setup-token\` — finish the"
  log "browser flow, then paste the token it prints."
  claude setup-token || log "\`claude setup-token\` did not complete — paste a token manually, or leave blank"
  prompt_secret CLAUDE_CODE_OAUTH_TOKEN "Paste the token from above (or leave blank to use ANTHROPIC_API_KEY instead)."
fi

prompt_secret GITHUB_TOKEN "A PAT with 'repo' scope — the agent pods clone and push with it. https://github.com/settings/tokens"
prompt_secret GHCR_TOKEN "A PAT with 'read:packages' — ghcr.io/re-cinq/ai-agent is a private package. https://github.com/settings/tokens"

if [ -z "$(env_value GHCR_USER)" ]; then
  # ghcr wants the GitHub LOGIN, so ask gh rather than git config — `user.name` is a
  # display name ("Ada Lovelace") and would authenticate as nobody.
  default_user="$(gh api user -q .login 2>/dev/null || echo "")"
  read -r -p "       GHCR_USER (GitHub login)${default_user:+ [$default_user]}: " ghcr_user
  ghcr_user="${ghcr_user:-$default_user}"
  if [ -n "$ghcr_user" ]; then
    set_env GHCR_USER "$ghcr_user"
    log "GHCR_USER saved to .env.local"
  else
    log "GHCR_USER left unset — re-run when you have it"
  fi
else
  log "GHCR_USER — already set, skipping"
fi

# Pods, not the host. Without this the Floor keeps the in-process planning path
# and no run is ever isolated — which is the whole reason to do any of the above.
if [ -z "$(env_value LORE_STATION_BACKEND)" ]; then
  set_env LORE_STATION_BACKEND k8s
  log "LORE_STATION_BACKEND=k8s — agent runs go to minikube pods"
else
  log "LORE_STATION_BACKEND=$(env_value LORE_STATION_BACKEND) — already set, skipping"
fi

log ""
log "Ready. Next: npm start"
log "  It brings up Postgres + Dgraph, bootstraps the ai-agent-subsystem on"
log "  minikube (pinned to that context), and runs the stack with live reload."
log "  Watch runs with: kubectl -n ai-agents get agents -w"
