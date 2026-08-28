#!/usr/bin/env bash
# Seed GCP Secret Manager with the values the Lore platform expects.
#
# Terraform creates the secret CONTAINERS (infra/terraform/secrets.tf) but never
# their values — a credential's value is not an infrastructure change and must
# not ride in on someone's laptop. This script fills the empty ones, once, for a
# fresh environment.
#
# Idempotent: a secret that already has an enabled version is left alone. Nothing
# is echoed, and values are read from the terminal, never from argv.
#
#   ./scripts/infra/seed-secrets.sh              # prompt for missing values
#   ./scripts/infra/seed-secrets.sh --check      # report only, exit 1 if any missing
#
# To ROTATE an existing secret, this is the wrong tool — see docs/managing-secrets.md.
set -euo pipefail

log() { echo "[lore] $*"; }
die() { echo "[lore] ERROR: $*" >&2; exit 1; }

CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

command -v gcloud >/dev/null || die "gcloud not found"
gcloud auth print-access-token >/dev/null 2>&1 || die "not logged in — run: gcloud auth login"

# Kept in step with local.secret_names in infra/terraform/secrets.tf. The two
# gated secrets are only needed when their enable_* tfvar is true, so a missing
# one is reported, not fatal.
REQUIRED=(
  lore-github-app-id
  lore-github-app-private-key
  lore-github-app-installation-id
  lore-anthropic-api-key
  lore-db-password
  lore-ingest-token
  lore-webhook-secret
  lore-agent-internal-token
  lore-slack-signing-secret
  lore-slack-bot-token
  lore-github-oauth-client-id
  lore-github-oauth-client-secret
  lore-nextauth-secret
  lore-ghcr-pull-secret
)
OPTIONAL=(
  lore-anthropic-admin-api-key
  lore-cluster-agent-registration-token
  lore-admin-token
)

has_value() {
  gcloud secrets versions list "$1" --filter='state:ENABLED' --limit=1 --format='value(name)' 2>/dev/null | grep -q .
}

exists() { gcloud secrets describe "$1" >/dev/null 2>&1; }

missing=0
for name in "${REQUIRED[@]}" "${OPTIONAL[@]}"; do
  optional=0
  case " ${OPTIONAL[*]} " in *" $name "*) optional=1 ;; esac

  if ! exists "$name"; then
    log "$name — container does not exist (run terraform apply first)"
    [ "$optional" -eq 1 ] || missing=1
    continue
  fi

  if has_value "$name"; then
    log "$name — already seeded, skipping"
    continue
  fi

  if [ "$CHECK_ONLY" -eq 1 ]; then
    log "$name — NO ENABLED VERSION"
    [ "$optional" -eq 1 ] || missing=1
    continue
  fi

  suffix=""
  [ "$optional" -eq 1 ] && suffix=" (optional — leave blank to skip)"
  # -r so a PEM's backslashes survive; -s so it never reaches the scrollback.
  printf '[lore] %s%s\n       value: ' "$name" "$suffix" >&2
  IFS= read -rs value
  echo >&2

  if [ -z "$value" ]; then
    log "$name — skipped"
    [ "$optional" -eq 1 ] || missing=1
    continue
  fi

  printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- >/dev/null
  log "$name — seeded"
done

if [ "$missing" -ne 0 ]; then
  log "One or more required secrets have no value. The platform will not start."
  exit 1
fi

log "All required secrets have an enabled version."
