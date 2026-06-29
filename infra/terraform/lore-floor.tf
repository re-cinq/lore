# --------------------------------------------------------------------------
# Lore Floor — Helm release
# --------------------------------------------------------------------------

resource "helm_release" "lore_agent" {
  name             = "lore-floor"
  chart            = "${path.module}/modules/gke-mcp/floor-helm"
  namespace        = "lore-floor"
  create_namespace = false

  set {
    name  = "image.tag"
    value = "latest"
  }

  # DB config (plain values)
  set {
    name  = "env.LORE_DB_HOST"
    value = "lore-db-rw.lore-db.svc.cluster.local"
  }
  set {
    name  = "env.LORE_DB_PORT"
    value = "5432"
  }
  set {
    name  = "env.LORE_DB_NAME"
    value = "lore"
  }
  set {
    name  = "env.LORE_DB_USER"
    value = "lore"
  }
  # Shared Dgraph (memory + spec-trace graphs). Enables graph ingest on the
  # cluster path; unset → createDgraphClient returns null and ingest self-skips.
  set {
    name  = "env.LORE_DGRAPH_HTTP"
    value = local.dgraph_http_url
  }
  set {
    name  = "env.ANTHROPIC_MODEL"
    value = "claude-haiku-4-5-20251001"
  }
  set {
    name  = "env.TASK_TYPES_PATH"
    value = "/config/task-types.yaml"
  }
  set {
    name  = "env.PORT"
    value = "8080"
  }
  set {
    name  = "env.LORE_INGEST_URL"
    value = var.lore_api_url
  }
  set {
    name  = "env.LORE_LOG_BUCKET"
    value = "lore-task-logs-${var.project_id}"
  }
  set {
    name  = "gcpProject"
    value = var.project_id
  }

  # Secrets — reference ESO-managed K8s Secrets
  set {
    name  = "dbPasswordSecret.name"
    value = "lore-db-password"
  }
  set {
    name  = "dbPasswordSecret.key"
    value = "password"
  }
  set {
    name  = "anthropicKeySecret.name"
    value = "lore-anthropic-key"
  }
  set {
    name  = "anthropicKeySecret.key"
    value = "anthropic-api-key"
  }
  set {
    name  = "anthropicAdminKeySecret.name"
    value = "lore-anthropic-key"
  }
  set {
    name  = "anthropicAdminKeySecret.key"
    value = "anthropic-admin-key"
  }
  set {
    name  = "githubAppSecret.name"
    value = "github-app-credentials"
  }
  set {
    name  = "githubAppSecret.appIdKey"
    value = "app-id"
  }
  set {
    name  = "githubAppSecret.privateKeyKey"
    value = "private-key"
  }
  set {
    name  = "githubAppSecret.installationIdKey"
    value = "installation-id"
  }
  set {
    name  = "ingestTokenSecret.name"
    value = "lore-ingest-token"
  }
  set {
    name  = "ingestTokenSecret.key"
    value = "token"
  }
  set {
    name  = "internalTokenSecret.name"
    value = "lore-agent-internal-token"
  }
  set {
    name  = "internalTokenSecret.key"
    value = "token"
  }
  set {
    name  = "webhookSecret.name"
    value = "lore-floor-webhook-secret"
  }
  set {
    name  = "webhookSecret.key"
    value = "secret"
  }

  # Task type config — inlined from scripts/task-types.yaml.
  # Passed via `values` (not `set`) because helm's CLI parser
  # can't handle commas in multi-line string values.
  values = [
    yamlencode({
      taskTypesConfig = file("${path.module}/../../scripts/task-types.yaml")
    })
  ]

  depends_on = [
    kubernetes_namespace.lore_agent,
  ]
}

# External ingress for the GitHub webhook (the ingress moved from mcp-server into
# the Floor). Created only when a webhook hostname is configured; routes just the
# webhook path to the Floor HTTP server (the handler HMAC-verifies in-process).
# Operator step after apply: repoint the GitHub App / org webhook to this host.
resource "kubernetes_ingress_v1" "lore_floor_webhook" {
  count = var.lore_webhook_hostname != "" ? 1 : 0

  metadata {
    name      = "lore-floor-webhook"
    namespace = "lore-floor"
    annotations = {
      "cert-manager.io/cluster-issuer"            = "letsencrypt-prod"
      "external-dns.alpha.kubernetes.io/hostname" = var.lore_webhook_hostname
    }
  }

  spec {
    ingress_class_name = "nginx-ingress"
    tls {
      hosts       = [var.lore_webhook_hostname]
      secret_name = "lore-floor-webhook-tls"
    }
    rule {
      host = var.lore_webhook_hostname
      http {
        path {
          path      = "/api/webhook/github"
          path_type = "Prefix"
          backend {
            service {
              name = "lore-floor"
              port {
                number = 8080
              }
            }
          }
        }
      }
    }
  }

  depends_on = [kubernetes_namespace.lore_agent]
}
