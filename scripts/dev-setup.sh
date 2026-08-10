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

# ------------------------------------------------- import from secrets.tfvars

# A deployer already holds every GitHub credential this needs, in terraform shapes:
# ghcr as a dockerconfigjson blob, the App as an id/installation/PEM triple. Minting
# fresh PATs to restate them is busywork and one more secret to leak. Read the file
# instead — but only what the agent pods need, and only with a yes: it is the most
# sensitive file in the checkout, so opening it is the developer's call, not the
# script's default.
#
# anthropic_api_key is deliberately NOT imported. setup-minikube-agents.sh prefers an
# API key when both are present, so importing it would silently move a laptop run onto
# org billing — the exact thing a subscription token is here to avoid.
TFVARS="$ROOT/infra/terraform/secrets.tfvars"

# The value is raw (escaped) JSON on one line, NOT base64 despite what
# secrets.tfvars.example's comment says. Unescape, pull the auth field, decode the
# `user:token` pair. Pure coreutils — no python dependency for an optional path.
ghcr_pair_from_tfvars() {
  local raw auth
  raw="$(sed -n 's/^ghcr_pull_secret_dockerconfigjson *= *"\(.*\)"$/\1/p' "$TFVARS")"
  [ -n "$raw" ] || return 1
  auth="$(printf '%s' "$raw" | sed 's/\\"/"/g' \
    | grep -o '"auth"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/')"
  [ -n "$auth" ] || return 1
  printf '%s' "$auth" | base64 -d 2>/dev/null
}

tfvar_scalar() {
  sed -n "s/^$1 *= *\"\(.*\)\"$/\1/p" "$TFVARS" | tail -1
}

# The PEM is a `<<-EOT … EOT` heredoc, so it needs the block, not a scalar.
tfvar_heredoc() {
  awk -v key="$1" '
    $0 ~ "^" key " *= *<<-?[A-Z]+" { collecting = 1; next }
    collecting && /^[[:space:]]*EOT[[:space:]]*$/ { exit }
    collecting { sub(/^[[:space:]]+/, ""); print }
  ' "$TFVARS"
}

# Only for values that must keep their newlines (the PEM). Append-only, so it is
# called solely when the variable is absent — which is also why it needs no removal
# pass: a multi-line assignment cannot be deleted by matching one line.
append_env_multiline() {
  printf '%s="%s"\n' "$1" "$2" >> "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

needs_github_creds() {
  [ -z "$(env_value GHCR_TOKEN)" ] ||
    { [ -z "$(env_value GITHUB_TOKEN)" ] && [ -z "$(env_value GITHUB_APP_ID)" ]; }
}

if [ -f "$TFVARS" ] && needs_github_creds; then
  log "Found infra/terraform/secrets.tfvars — it already holds the ghcr pull"
  log "credentials and the GitHub App, which is everything the agent pods need."
  read -r -p "       Import them into .env.local? [Y/n]: " answer
  if [ "${answer:-Y}" != "n" ] && [ "${answer:-Y}" != "N" ]; then
    if pair="$(ghcr_pair_from_tfvars)" && [ -n "$pair" ]; then
      [ -n "$(env_value GHCR_USER)" ] || set_env GHCR_USER "${pair%%:*}"
      [ -n "$(env_value GHCR_TOKEN)" ] || set_env GHCR_TOKEN "${pair#*:}"
      log "Imported GHCR_USER (${pair%%:*}) + GHCR_TOKEN"
    else
      log "Could not read ghcr_pull_secret_dockerconfigjson — falling back to prompts"
    fi

    app_id="$(tfvar_scalar github_app_id)"
    app_install="$(tfvar_scalar github_app_installation_id)"
    app_key="$(tfvar_heredoc github_app_private_key)"
    if [ -n "$app_id" ] && [ -n "$app_install" ] && [ -n "$app_key" ] \
       && [ -z "$(env_value GITHUB_APP_ID)" ]; then
      set_env GITHUB_APP_ID "$app_id"
      set_env GITHUB_APP_INSTALLATION_ID "$app_install"
      append_env_multiline GITHUB_APP_PRIVATE_KEY "$app_key"
      log "Imported the GitHub App triple — pods mint installation tokens as prod does"
    fi
  fi
fi

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

# The App triple outranks the PAT in platform-github.ts, so asking for one after
# importing the App would be asking for a credential nothing reads.
if [ -n "$(env_value GITHUB_APP_ID)" ]; then
  log "GITHUB_TOKEN — not needed, the GitHub App is configured"
else
  prompt_secret GITHUB_TOKEN "A PAT with 'repo' scope — the agent pods clone and push with it. Or: gh auth token. https://github.com/settings/tokens"
fi
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
