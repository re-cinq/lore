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
        name = "agent-secrets"
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

# The chart (CRDs + controller + RBAC + cross-namespace Floor binding + run-pod
# NetworkPolicy). create_namespace=false: the namespace + ESO secrets exist first.
# No --wait (Autopilot rollout-wait wedges releases — see the helm/terraform notes).
resource "helm_release" "ai_agents" {
  name             = "ai-agents"
  chart            = "${path.module}/modules/gke-mcp/ai-agents-helm"
  namespace        = "ai-agents"
  create_namespace = false

  depends_on = [
    kubernetes_namespace.ai_agents,
    kubectl_manifest.es_ai_agents_secrets,
    kubectl_manifest.es_ai_agents_ghcr,
  ]
}
