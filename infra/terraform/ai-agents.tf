# --------------------------------------------------------------------------
# ai-agent-subsystem (ADR-031) — namespace, ESO-managed secrets, Helm release.
#
# Deploys the standalone subsystem (CRDs + controller + RBAC + run-pod
# NetworkPolicy) as a Helm chart, alongside the incumbent LoreTask path during
# the cutover. Secrets are INHERITED from the existing GCP Secret Manager entries
# (the same remoteRefs the Floor uses) — no new secret material.
# --------------------------------------------------------------------------

resource "kubernetes_namespace" "ai_agents" {
  metadata {
    name = "ai-agents"
    labels = {
      "agents.re-cinq.com/system" = "true"
    }
  }
}

# agent-secrets: the single Secret the controller mounts allowlisted keys from.
# ANTHROPIC_API_KEY + the Lore API tokens, mirrored from the SAME remoteRefs the
# Floor consumes. The Floor PATCHes short-lived per-task GitHub tokens in/out later
# (re-cinq/lore#685); this provisions the inherited baseline only.
#
# The Secret has TWO writers: ESO (the static baseline below) and the Floor (dynamic
# per-task GH_TOKEN_<id> keys, patched in per run and removed on terminal). ESO's
# default creationPolicy (Owner) PRUNES keys it doesn't manage on every reconcile —
# deleting the Floor's tokens mid-run, so run pods fail CreateContainerConfigError
# on their (non-optional) GH_TOKEN secretKeyRef. `Merge` scopes ESO to its own keys.
# Merge does not create the target, so terraform bootstraps the Secret itself.
resource "kubernetes_secret" "agent_secrets_bootstrap" {
  metadata {
    name      = "agent-secrets"
    namespace = "ai-agents"
  }

  lifecycle {
    # ESO merges the baseline keys and the Floor patches per-task tokens into `data`;
    # terraform owns only the Secret's existence, never its content or their markers.
    ignore_changes = [data, metadata[0].annotations, metadata[0].labels]
  }

  depends_on = [kubernetes_namespace.ai_agents]
}

resource "kubectl_manifest" "es_ai_agents_secrets" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "agent-secrets"
      namespace = "ai-agents"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name           = "agent-secrets"
        creationPolicy = "Merge"
        # The seeded recipes' http telemetry sink declares `headers_secret: agent-events-auth`,
        # which the controller injects as a NON-optional secretKeyRef from THIS Secret — so the
        # key must live here or every run pod fails CreateContainerConfigError. The supervisor
        # sends the key's VALUE verbatim as HTTP header lines, so it must be the full
        # `Authorization: Bearer <token>` line — a bare token renders no Authorization header
        # and the Floor 401s every event (telemetry silently dropped; found 2026-07-15).
        # template.mergePolicy Merge keeps the plain data keys below alongside this one.
        template = {
          engineVersion = "v2"
          mergePolicy   = "Merge"
          data = {
            "agent-events-auth" = "Authorization: Bearer {{ .LORE_AGENT_INTERNAL_TOKEN }}"
            # The seeded agent recipes' `resources.mcp_servers` lore entry declares
            # `headers_secret: lore-mcp-auth`; the controller injects it as the MCP
            # request's Authorization header, so (like agent-events-auth) it must be the
            # full `Authorization: Bearer <token>` line. v1 reuses the already-pulled
            # LORE_INGEST_TOKEN — the same token the lore-mcp gateway validates incoming
            # requests against (its LORE_MCP_AUTH_TOKEN is sourced from lore-ingest-token),
            # so no new GSM secret material is needed.
            "lore-mcp-auth" = "Authorization: Bearer {{ .LORE_INGEST_TOKEN }}"
          }
        }
      }
      data = [
        {
          secretKey = "ANTHROPIC_API_KEY"
          remoteRef = { key = "lore-anthropic-api-key" }
        },
        {
          secretKey = "LORE_INGEST_TOKEN"
          remoteRef = { key = "lore-ingest-token" }
        },
        {
          secretKey = "LORE_AGENT_INTERNAL_TOKEN"
          remoteRef = { key = "lore-agent-internal-token" }
        },
      ]
    }
  })

  depends_on = [
    kubectl_manifest.cluster_secret_store,
    kubernetes_namespace.ai_agents,
    kubernetes_secret.agent_secrets_bootstrap,
  ]
}

# Run pods (created by the controller under the namespace `default` ServiceAccount) pull the
# private ai-agent image from GHCR — without a pull secret on that SA every run fails
# ImagePullBackOff/401. Bind ghcr-pull-secret to the auto-created default SA so a fresh install
# authenticates. The controller Deployment gets its own imagePullSecrets via the chart.
resource "kubernetes_default_service_account" "ai_agents" {
  metadata {
    namespace = "ai-agents"
  }
  image_pull_secret {
    name = "ghcr-pull-secret"
  }
  depends_on = [
    kubernetes_namespace.ai_agents,
    kubectl_manifest.es_ai_agents_ghcr,
  ]
}

# ghcr-pull-secret: the same GHCR credentials the rest of the platform pulls with.
resource "kubectl_manifest" "es_ai_agents_ghcr" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "ghcr-pull-secret"
      namespace = "ai-agents"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "ghcr-pull-secret"
        template = {
          type = "kubernetes.io/dockerconfigjson"
          data = {
            ".dockerconfigjson" = "{{ .dockerconfigjson }}"
          }
        }
      }
      data = [
        {
          secretKey = "dockerconfigjson"
          remoteRef = { key = "lore-ghcr-pull-secret" }
        },
      ]
    }
  })

  depends_on = [
    kubectl_manifest.cluster_secret_store,
    kubernetes_namespace.ai_agents,
  ]
}

# The ai-agents chart (CRDs + controller + RBAC + cross-namespace Floor binding +
# run-pod NetworkPolicy) is deployed by the umbrella Helm release
# (`helm_release.lore_platform` in lore-platform.tf), under the `ai-agents`
# subchart key. The namespace and the ESO-managed secrets above exist first
# (the umbrella release depends_on them).
