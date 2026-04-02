# ---------------------------------------------------------------------------
# ExternalSecret CRs — one per K8s secret per namespace
# ---------------------------------------------------------------------------

# ===== lore-agent namespace =================================================

resource "kubectl_manifest" "es_agent_github_app" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "github-app-credentials"
      namespace = "lore-agent"
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
      namespace = "lore-agent"
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
      data = [
        {
          secretKey = "anthropic-api-key"
          remoteRef = {
            key = "lore-anthropic-api-key"
          }
        },
      ]
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
      namespace = "lore-agent"
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
      namespace = "lore-agent"
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
      namespace = "lore-agent"
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

# ===== mcp-servers namespace ================================================

resource "kubectl_manifest" "es_mcp_github_app" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "github-app-credentials"
      namespace = "mcp-servers"
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
      name      = "lore-mcp-db-password"
      namespace = "mcp-servers"
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef = {
        name = "gcp-secret-manager"
        kind = "ClusterSecretStore"
      }
      target = {
        name = "lore-mcp-db-password"
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
      namespace = "mcp-servers"
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

resource "kubectl_manifest" "es_mcp_webhook_secret" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "lore-webhook-secret"
      namespace = "mcp-servers"
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

resource "kubectl_manifest" "es_mcp_ghcr" {
  yaml_body = yamlencode({
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "ghcr-pull-secret"
      namespace = "mcp-servers"
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
