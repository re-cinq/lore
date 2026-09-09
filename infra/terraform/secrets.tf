# ---------------------------------------------------------------------------
# GCP Secret Manager: Terraform owns the CONTAINERS, never the MATERIAL.
#
# A secret's *name* is infrastructure — declarative, reviewable, committed.
# A secret's *value* is not: it changes on a rotation schedule that has nothing
# to do with an infrastructure change, and it lives in exactly one place.
#
# Terraform used to write `google_secret_manager_secret_version` from
# `var.*` (i.e. from whichever laptop's gitignored tfvars ran the apply). That
# gave every developer a private, silently-divergent copy of the source of
# truth: rotate a secret, and the next apply from a stale checkout pushed the
# OLD value back up as a new version. Nobody typed anything wrong; the tool
# did it for them.
#
# Rotation is now a runtime operation against the one live copy:
#
#   printf '%s' "$NEW_VALUE" | gcloud secrets versions add lore-<name> --data-file=-
#
# then restart the consumers (see docs/managing-secrets.md). Terraform reads a
# value back only where it genuinely needs one at plan time — see the
# `data "google_secret_manager_secret_version"` in lore-db.tf. Everything else
# is resolved by NAME at runtime by External Secrets Operator.
# ---------------------------------------------------------------------------

locals {
  # The secrets this platform expects to exist. Adding a name here creates an
  # empty container; seed its first version with scripts/infra/seed-secrets.sh.
  secret_names = concat([
    "lore-github-app-id",
    "lore-github-app-private-key",
    "lore-github-app-installation-id",
    "lore-anthropic-api-key",
    "lore-db-password",
    "lore-ingest-token",
    "lore-webhook-secret",
    "lore-agent-internal-token",
    "lore-slack-signing-secret",
    "lore-slack-bot-token",
    "lore-github-oauth-client-id",
    "lore-github-oauth-client-secret",
    "lore-nextauth-secret",
    # Binary/base64 .dockerconfigjson for GHCR pull access.
    "lore-ghcr-pull-secret",
    # Every cluster-agent registers — the central one included — so this is a
    # platform secret, not a feature gate.
    "lore-cluster-agent-registration-token",
    ],
    var.enable_anthropic_admin_key ? ["lore-anthropic-admin-api-key"] : [],
    var.enable_gemini ? ["lore-gemini-api-key"] : [],
  )
}

resource "google_secret_manager_secret" "lore" {
  for_each  = toset(local.secret_names)
  secret_id = each.key

  replication {
    auto {}
  }

  # A container holds every historical version of a live credential. Losing it
  # to a rename, a refactor, or a fat-fingered `-target` is unrecoverable, so
  # deletion has to be a deliberate two-step: drop this block, then apply.
  lifecycle {
    prevent_destroy = true
  }
}

# The GHCR pull secret used to be its own resource, `google_secret_manager_secret.ghcr`,
# because its value is a raw dockerconfigjson blob rather than a scalar. Once
# Terraform stopped owning VALUES that distinction disappeared, so it folded into
# the map above — under the same secret_id it always had.
#
# Without this block Terraform reads that as a delete-and-create of the same GCP
# secret: it would destroy the container, taking every version of the PAT with
# it, then recreate it empty, and image pulls would start failing in all four
# namespaces that reference it. `moved` re-keys the existing resource in state
# instead. Keep it: removing it re-arms the same destroy for anyone whose state
# still carries the old address.
moved {
  from = google_secret_manager_secret.ghcr
  to   = google_secret_manager_secret.lore["lore-ghcr-pull-secret"]
}
