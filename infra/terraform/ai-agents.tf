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

# agent-events-auth: the Authorization header the seeded recipes' http telemetry sink
# (headers_secret: agent-events-auth) sends to the Floor's /api/agent-events endpoint.
# The Floor authenticates it as `Bearer <LORE_AGENT_INTERNAL_TOKEN>` (#687) — same
# remoteRef as the agent-secrets internal token, templated into the header value.
resource "kubectl_manifest" "es_ai_agents_events_auth" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "agent-events-auth"
      namespace = "ai-agents"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "agent-events-auth"
        template = {
          data = {
            Authorization = "Bearer {{ .token }}"
          }
        }
      }
      data = [
        {
          secretKey = "token"
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

# The ai-agents chart (CRDs + controller + RBAC + cross-namespace Floor binding +
# run-pod NetworkPolicy) is deployed by the umbrella Helm release
# (`helm_release.lore_platform` in lore-platform.tf), under the `ai-agents`
# subchart key. The namespace and the ESO-managed secrets above exist first
# (the umbrella release depends_on them).
