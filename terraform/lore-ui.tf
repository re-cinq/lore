# --------------------------------------------------------------------------
# Lore UI — Helm release, ServiceAccount, and Ingress
# --------------------------------------------------------------------------

resource "kubernetes_service_account" "lore_ui" {
  metadata {
    name      = "lore-ui"
    namespace = "lore-ui"
    annotations = {
      "iam.gke.io/gcp-service-account" = "lore-ui@${var.project_id}.iam.gserviceaccount.com"
    }
  }
}

resource "helm_release" "lore_ui" {
  name      = "lore-ui"
  chart     = "${path.module}/modules/gke-mcp/ui-helm"
  namespace = "lore-ui"

  set {
    name  = "image.tag"
    value = "latest"
  }
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
  set {
    name  = "env.GITHUB_ALLOWED_ORG"
    value = var.github_org
  }
  set {
    name  = "env.NEXTAUTH_URL"
    value = var.lore_ui_url
  }
  set {
    name  = "env.LORE_LOG_BUCKET"
    value = "lore-task-logs-${var.project_id}"
  }

  # Secrets
  set {
    name  = "dbPasswordSecret.name"
    value = "lore-db-password"
  }
  set {
    name  = "dbPasswordSecret.key"
    value = "password"
  }
  set {
    name  = "githubAppSecret.name"
    value = "github-app-credentials"
  }
  set {
    name  = "oauthSecret.name"
    value = "lore-ui-oauth"
  }

  depends_on = [
    kubernetes_namespace.lore_ui,
    kubernetes_service_account.lore_ui,
  ]
}

resource "kubernetes_ingress_v1" "lore_ui" {
  metadata {
    name      = "lore-ui"
    namespace = "lore-ui"

    annotations = {
      "cert-manager.io/cluster-issuer"            = "letsencrypt-prod"
      "external-dns.alpha.kubernetes.io/hostname" = var.lore_ui_hostname
    }
  }

  spec {
    ingress_class_name = "nginx-ingress"

    tls {
      hosts       = [var.lore_ui_hostname]
      secret_name = "lore-ui-tls"
    }

    rule {
      host = var.lore_ui_hostname

      http {
        path {
          path      = "/"
          path_type = "Prefix"

          backend {
            service {
              name = "lore-ui"
              port {
                number = 3000
              }
            }
          }
        }
      }
    }
  }

  depends_on = [kubernetes_namespace.lore_ui]
}
