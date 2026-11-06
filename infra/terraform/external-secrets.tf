# ---------------------------------------------------------------------------
# ExternalSecret CRs — one per K8s secret per namespace
# ---------------------------------------------------------------------------

# ===== lore-api namespace ================================================

# Slack credentials for the lore-api namespace
# The GitHub OAuth app lore-api signs people in with for the web UI (ADR-053).
# ===== lore-ui namespace ====================================================

# --------------------------------------------------------------------------
# Stations (lore-stations namespace) — ADR-024 service stations
#
# All materialized from the SAME GCP secrets the other services read. The
# ingest token in particular MUST match the Floor's, or every station call it
# makes is refused 401. merge-check merges PRs and comments on issues, so it
# needs the GitHub App triple; the Anthropic key is optional (absent → the
# episode is written, the auto-curation step is skipped).
# --------------------------------------------------------------------------

# lore-api's own bearer token, for the stations that read and write through
# lore-api over HTTP (the issues station files Issues and spec-tasks this way).
# lore-agent-internal-token above is only the Floor<->stations token; lore-api
# does not accept it, so every such call answered 403 (plan 3b3a67af,
# 2026-09-29: "GET /labels failed: 403").
# The Slack bot token for the stations that post to Slack: the escalation notify
# step (which posted nothing without it, #2201) and the daily digest once its
# line runs on the external floor (#2337). Same GSM secret the lore-api
# namespace already mirrors.
# ===== headlamp namespace ===================================================

# The one secret Headlamp's sign-in needs. The three keys are not named to taste:
# `client-id` / `client-secret` / `cookie-secret` are the literal keys the
# oauth2-proxy chart reads (its `config.requiredSecretKeys` default), so renaming
# any of them leaves the proxy starting with no credential at all.
resource "kubectl_manifest" "es_headlamp_oauth" {
  count = var.enable_headlamp ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "headlamp-oauth"
      namespace = "headlamp"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "headlamp-oauth"
      }
      data = [
        {
          secretKey = "client-id"
          remoteRef = {
            key = "lore-headlamp-oauth-client-id"
          }
        },
        {
          secretKey = "client-secret"
          remoteRef = {
            key = "lore-headlamp-oauth-client-secret"
          }
        },
        {
          secretKey = "cookie-secret"
          remoteRef = {
            key = "lore-headlamp-cookie-secret"
          }
        },
      ]
    }
  })

  depends_on = [
    kubectl_manifest.cluster_secret_store,
    kubernetes_namespace.headlamp,
  ]
}

# ===== external floor =======================================================
# Gated by var.enable_external_floor: the floor engine runs in its own
# namespace and Helm release; these carry the credentials between it and Lore.

# The floor's agent pods read header secrets from `agent-secrets` in namespace
# `floor`, a Secret its own Helm release owns; Merge adds only the key the Lore
# MCP gateway needs (the bare `Bearer <token>` credential).
# Grafana's sign-in proxy: its own Google OAuth web client and cookie key
# (secrets.tf, behind enable_monitoring), mirrored into the monitoring namespace
# under the key names the oauth2-proxy chart reads (monitoring.tf, ADR-050).
resource "kubectl_manifest" "es_grafana_oauth" {
  count = var.enable_monitoring ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "grafana-oauth"
      namespace = local.monitoring_namespace
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "grafana-oauth"
      }
      data = [
        {
          secretKey = "client-id"
          remoteRef = {
            key = "lore-grafana-oauth-client-id"
          }
        },
        {
          secretKey = "client-secret"
          remoteRef = {
            key = "lore-grafana-oauth-client-secret"
          }
        },
        {
          secretKey = "cookie-secret"
          remoteRef = {
            key = "lore-grafana-cookie-secret"
          }
        },
      ]
    }
  })

  depends_on = [kubernetes_namespace.monitoring]
}

# ===== utopia namespace =====================================================

# Utopia's sign-in proxy: its own Google OAuth web client and cookie key
# (secrets.tf, behind enable_utopia), under the key names the oauth2-proxy chart
# reads (utopia.tf).
# The key Utopia seals stored model credentials with (UTOPIA_SECRET_KEY). The
# database password is not mirrored: terraform reads it into the CNPG
# credentials Secret, as lore-db does, and the app reads that one.
# The password of utopia_app, the restricted role the app runs as (utopia.tf,
# managed.roles). Mirrored as the basic-auth Secret CNPG reads to set the role's
# password and the app reads for UTOPIA_APP_DB_PASSWORD, so the value is in neither
# the Cluster manifest nor terraform state.
# The GHCR pull secret, for a Utopia image of our own: a build pushed to
# ghcr.io/re-cinq is internal to the org, which the kubelet is not.
# The Utopia write token lore-api sets a repo's knowledge base up with on its
# first spec/ADR ingest (UTOPIA_TOKEN); see var.enable_utopia_auto_setup.
# The lore-reviewer GitHub App the auto-merge loop approves as (LORE_REVIEWER_APP_*
# in lore-stations); see var.enable_lore_reviewer.
