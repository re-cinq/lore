# ---------------------------------------------------------------------------
# ExternalSecret CRs — one per K8s secret per namespace
# ---------------------------------------------------------------------------

# ===== lore-floor namespace =================================================

resource "kubectl_manifest" "es_agent_github_app" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "github-app-credentials"
      namespace = "lore-floor"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "github-app-credentials"
      }
      data = [
        {
          secretKey = "app-id"
          remoteRef = {
            key = "lore-github-app-id"
          }
        },
        {
          secretKey = "private-key"
          remoteRef = {
            key = "lore-github-app-private-key"
          }
        },
        {
          secretKey = "installation-id"
          remoteRef = {
            key = "lore-github-app-installation-id"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

resource "kubectl_manifest" "es_agent_anthropic" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-anthropic-key"
      namespace = "lore-floor"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-anthropic-key"
      }
      data = concat([
        {
          secretKey = "anthropic-api-key"
          remoteRef = {
            key = "lore-anthropic-api-key"
          }
        },
        ], var.enable_anthropic_admin_key ? [
        {
          secretKey = "anthropic-admin-key"
          remoteRef = {
            key = "lore-anthropic-admin-api-key"
          }
        },
      ] : [])
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

resource "kubectl_manifest" "es_agent_db_password" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-db-password"
      namespace = "lore-floor"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-db-password"
      }
      data = [
        {
          secretKey = "password"
          remoteRef = {
            key = "lore-db-password"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

resource "kubectl_manifest" "es_agent_ingest_token" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-ingest-token"
      namespace = "lore-floor"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-ingest-token"
      }
      data = [
        {
          secretKey = "token"
          remoteRef = {
            key = "lore-ingest-token"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

resource "kubectl_manifest" "es_agent_ghcr" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "ghcr-pull-secret"
      namespace = "lore-floor"
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
          remoteRef = {
            key = "lore-ghcr-pull-secret"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

# ===== lore-api namespace ================================================

resource "kubectl_manifest" "es_mcp_anthropic" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-anthropic-key"
      namespace = "lore-api"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-anthropic-key"
      }
      data = concat([
        {
          secretKey = "anthropic-api-key"
          remoteRef = {
            key = "lore-anthropic-api-key"
          }
        },
        ], var.enable_anthropic_admin_key ? [
        {
          secretKey = "anthropic-admin-key"
          remoteRef = {
            key = "lore-anthropic-admin-api-key"
          }
        },
      ] : [])
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

resource "kubectl_manifest" "es_mcp_github_app" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "github-app-credentials"
      namespace = "lore-api"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "github-app-credentials"
      }
      data = [
        {
          secretKey = "app-id"
          remoteRef = {
            key = "lore-github-app-id"
          }
        },
        {
          secretKey = "private-key"
          remoteRef = {
            key = "lore-github-app-private-key"
          }
        },
        {
          secretKey = "installation-id"
          remoteRef = {
            key = "lore-github-app-installation-id"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

resource "kubectl_manifest" "es_mcp_db_password" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-api-db-password"
      namespace = "lore-api"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-api-db-password"
      }
      data = [
        {
          secretKey = "password"
          remoteRef = {
            key = "lore-db-password"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

resource "kubectl_manifest" "es_mcp_ingest_token" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-ingest-token"
      namespace = "lore-api"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-ingest-token"
      }
      data = [
        {
          secretKey = "token"
          remoteRef = {
            key = "lore-ingest-token"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

# Unconditional since 2026-08-29: every cluster-agent registers, so the token is
# a platform secret rather than a feature gate.
#
# `moved` is load-bearing. Dropping `count` renames the address from
# `...[0]` to `...`, and without these blocks terraform plans a
# destroy-then-create. ESO's default creationPolicy is Owner, so the destroy
# takes the mirrored Kubernetes Secret with it — and with `optional: true` now
# gone from both consumers, any pod restart inside that window is a
# CreateContainerConfigError.
moved {
  from = kubectl_manifest.es_cluster_agent_registration_token[0]
  to   = kubectl_manifest.es_cluster_agent_registration_token
}

moved {
  from = kubectl_manifest.es_cluster_agent_registration_token_agent_ns[0]
  to   = kubectl_manifest.es_cluster_agent_registration_token_agent_ns
}

resource "kubectl_manifest" "es_cluster_agent_registration_token" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-cluster-agent-registration-token"
      namespace = "lore-api"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-cluster-agent-registration-token"
      }
      data = [
        {
          secretKey = "token"
          remoteRef = {
            key = "lore-cluster-agent-registration-token"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

resource "kubectl_manifest" "es_cluster_agent_registration_token_agent_ns" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-cluster-agent-registration-token"
      namespace = "lore-cluster-agent"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-cluster-agent-registration-token"
      }
      data = [
        {
          secretKey = "token"
          remoteRef = {
            key = "lore-cluster-agent-registration-token"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

resource "kubectl_manifest" "es_agent_internal_token" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-agent-internal-token"
      namespace = "lore-floor"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-agent-internal-token"
      }
      data = [
        {
          secretKey = "token"
          remoteRef = {
            key = "lore-agent-internal-token"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

resource "kubectl_manifest" "es_mcp_internal_token" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-agent-internal-token"
      namespace = "lore-api"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-agent-internal-token"
      }
      data = [
        {
          secretKey = "token"
          remoteRef = {
            key = "lore-agent-internal-token"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

resource "kubectl_manifest" "es_mcp_webhook_secret" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-webhook-secret"
      namespace = "lore-api"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-webhook-secret"
      }
      data = [
        {
          secretKey = "secret"
          remoteRef = {
            key = "lore-webhook-secret"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

# The GitHub webhook ingress moved into the Floor, so the same GCP secret must
# also materialize into the lore-floor namespace. Same remoteRef key as the
# lore-api ES above.
resource "kubectl_manifest" "es_floor_webhook_secret" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-floor-webhook-secret"
      namespace = "lore-floor"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-floor-webhook-secret"
      }
      data = [
        {
          secretKey = "secret"
          remoteRef = {
            key = "lore-webhook-secret"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

resource "kubectl_manifest" "es_mcp_ghcr" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "ghcr-pull-secret"
      namespace = "lore-api"
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
          remoteRef = {
            key = "lore-ghcr-pull-secret"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

# Slack credentials — shared by both lore-api and lore-floor namespaces
resource "kubectl_manifest" "es_mcp_slack" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-slack-credentials"
      namespace = "lore-api"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-slack-credentials"
      }
      data = [
        {
          secretKey = "signing-secret"
          remoteRef = {
            key = "lore-slack-signing-secret"
          }
        },
        {
          secretKey = "bot-token"
          remoteRef = {
            key = "lore-slack-bot-token"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

resource "kubectl_manifest" "es_agent_slack" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-slack-credentials"
      namespace = "lore-floor"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-slack-credentials"
      }
      data = [
        {
          secretKey = "bot-token"
          remoteRef = {
            key = "lore-slack-bot-token"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

# ===== lore-ui namespace ====================================================

resource "kubectl_manifest" "es_ui_github_app" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "github-app-credentials"
      namespace = "lore-ui"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "github-app-credentials"
      }
      data = [
        {
          secretKey = "app-id"
          remoteRef = {
            key = "lore-github-app-id"
          }
        },
        {
          secretKey = "private-key"
          remoteRef = {
            key = "lore-github-app-private-key"
          }
        },
        {
          secretKey = "installation-id"
          remoteRef = {
            key = "lore-github-app-installation-id"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

resource "kubectl_manifest" "es_ui_db_password" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-db-password"
      namespace = "lore-ui"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-db-password"
      }
      data = [
        {
          secretKey = "password"
          remoteRef = {
            key = "lore-db-password"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

resource "kubectl_manifest" "es_ui_ingest_token" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-ingest-token"
      namespace = "lore-ui"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-ingest-token"
      }
      data = [
        {
          secretKey = "token"
          remoteRef = {
            key = "lore-ingest-token"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

# Admin-scoped token for web-ui → mcp-server two-key-gated settings writes.
# Gated by var.enable_ui_admin_token so it isn't a perpetually-failing sync
# before the operator mints the token + populates the `lore-admin-token` GCP
# Secret Manager key. The deployment's LORE_ADMIN_TOKEN env is optional, so a
# missing secret never stalls the UI rollout.
resource "kubectl_manifest" "es_ui_admin_token" {
  count = var.enable_ui_admin_token ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-admin-token"
      namespace = "lore-ui"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-admin-token"
      }
      data = [
        {
          secretKey = "token"
          remoteRef = {
            key = "lore-admin-token"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

resource "kubectl_manifest" "es_ui_oauth" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-ui-oauth"
      namespace = "lore-ui"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-ui-oauth"
      }
      data = [
        {
          secretKey = "client-id"
          remoteRef = {
            key = "lore-github-oauth-client-id"
          }
        },
        {
          secretKey = "client-secret"
          remoteRef = {
            key = "lore-github-oauth-client-secret"
          }
        },
        {
          secretKey = "nextauth-secret"
          remoteRef = {
            key = "lore-nextauth-secret"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

resource "kubectl_manifest" "es_ui_ghcr" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "ghcr-pull-secret"
      namespace = "lore-ui"
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
          remoteRef = {
            key = "lore-ghcr-pull-secret"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

# --------------------------------------------------------------------------
# Event router (lore-event-router namespace) — ADR-044
#
# Three secrets, all materialized from the SAME GCP secrets the other services
# already read. None is new material: the router verifies the same GitHub
# webhook HMAC the Floor verifies today, and accepts the same internal token
# every producer already presents. Sharing the remoteRef is the point — a
# router and a producer holding different tokens would refuse every report,
# and a router and GitHub holding different webhook secrets would refuse every
# delivery.
# --------------------------------------------------------------------------

resource "kubectl_manifest" "es_event_router_db_password" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-event-router-db-password"
      namespace = "lore-event-router"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-event-router-db-password"
      }
      data = [
        {
          secretKey = "password"
          remoteRef = {
            key = "lore-db-password"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

resource "kubectl_manifest" "es_event_router_webhook_secret" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-event-router-webhook"
      namespace = "lore-event-router"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-event-router-webhook"
      }
      data = [
        {
          secretKey = "webhook-secret"
          remoteRef = {
            key = "lore-webhook-secret"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

resource "kubectl_manifest" "es_event_router_internal_token" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-agent-internal-token"
      namespace = "lore-event-router"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-agent-internal-token"
      }
      data = [
        {
          secretKey = "token"
          remoteRef = {
            key = "lore-agent-internal-token"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

# --------------------------------------------------------------------------
# Stations (lore-stations namespace) — ADR-024 service stations
#
# All materialized from the SAME GCP secrets the other services read. The
# ingest token in particular MUST match the Floor's, or every station call it
# makes is refused 401. merge-check merges PRs and comments on issues, so it
# needs the GitHub App triple; the Anthropic key is optional (absent → the
# episode is written, the auto-curation step is skipped).
# --------------------------------------------------------------------------

resource "kubectl_manifest" "es_stations_db_password" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-stations-db-password"
      namespace = "lore-stations"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-stations-db-password"
      }
      data = [
        {
          secretKey = "password"
          remoteRef = {
            key = "lore-db-password"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

resource "kubectl_manifest" "es_stations_internal_token" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-agent-internal-token"
      namespace = "lore-stations"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-agent-internal-token"
      }
      data = [
        {
          secretKey = "token"
          remoteRef = {
            key = "lore-agent-internal-token"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

resource "kubectl_manifest" "es_stations_github_app" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-stations-github-app"
      namespace = "lore-stations"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-stations-github-app"
      }
      data = [
        {
          secretKey = "app-id"
          remoteRef = {
            key = "lore-github-app-id"
          }
        },
        {
          secretKey = "private-key"
          remoteRef = {
            key = "lore-github-app-private-key"
          }
        },
        {
          secretKey = "installation-id"
          remoteRef = {
            key = "lore-github-app-installation-id"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

resource "kubectl_manifest" "es_stations_anthropic_key" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-stations-anthropic-key"
      namespace = "lore-stations"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-stations-anthropic-key"
      }
      # The org admin key is a SECOND entry on the same secret, projected only
      # when var.enable_anthropic_admin_key is true — mirrors es_mcp_anthropic. The
      # anthropic-cost-sync station (moved here from lore-api in #1522) reads it
      # as ANTHROPIC_ADMIN_KEY; without it the nightly cost sync skips.
      data = concat([
        {
          secretKey = "anthropic-api-key"
          remoteRef = {
            key = "lore-anthropic-api-key"
          }
        },
        ], var.enable_anthropic_admin_key ? [
        {
          secretKey = "anthropic-admin-key"
          remoteRef = {
            key = "lore-anthropic-admin-api-key"
          }
        },
      ] : [])
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

# --------------------------------------------------------------------------
# Cluster agent (lore-cluster-agent namespace) — ADR-024
#
# No database credential: this service holds no pool. It DOES hold the GitHub
# App triple, because it mints the per-task installation token itself so no
# token crosses the network — the trade recorded in the ADR is that the App
# private key now lives here as well as on the Floor.
#
# The ingest token must match the Floor's and lore-api's, or every call they
# make is refused 401.
# --------------------------------------------------------------------------

resource "kubectl_manifest" "es_cluster_agent_internal_token" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-agent-internal-token"
      namespace = "lore-cluster-agent"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-agent-internal-token"
      }
      data = [
        {
          secretKey = "token"
          remoteRef = {
            key = "lore-agent-internal-token"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}

resource "kubectl_manifest" "es_cluster_agent_github_app" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-cluster-agent-github-app"
      namespace = "lore-cluster-agent"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-cluster-agent-github-app"
      }
      data = [
        {
          secretKey = "app-id"
          remoteRef = {
            key = "lore-github-app-id"
          }
        },
        {
          secretKey = "private-key"
          remoteRef = {
            key = "lore-github-app-private-key"
          }
        },
        {
          secretKey = "installation-id"
          remoteRef = {
            key = "lore-github-app-installation-id"
          }
        },
      ]
    }
  })

  depends_on = [kubectl_manifest.cluster_secret_store]
}
