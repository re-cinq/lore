# --------------------------------------------------------------------------
# Lore UI — Deployment, Service, and Ingress
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

resource "kubernetes_deployment" "lore_ui" {
  metadata {
    name      = "lore-ui"
    namespace = "lore-ui"
    labels    = { app = "lore-ui" }
  }

  spec {
    replicas = 1

    selector {
      match_labels = { app = "lore-ui" }
    }

    template {
      metadata {
        labels = { app = "lore-ui" }
      }

      spec {
        service_account_name = "lore-ui"

        image_pull_secrets {
          name = "ghcr-pull-secret"
        }

        container {
          name              = "ui"
          image             = "ghcr.io/re-cinq/lore-ui:latest"
          image_pull_policy = "Always"

          port {
            name           = "http"
            container_port = 3000
          }

          # Plain env vars
          env {
            name  = "LORE_DB_HOST"
            value = "lore-db-rw.alloydb.svc.cluster.local"
          }
          env {
            name  = "LORE_DB_PORT"
            value = "5432"
          }
          env {
            name  = "LORE_DB_NAME"
            value = "lore"
          }
          env {
            name  = "LORE_DB_USER"
            value = "lore"
          }
          env {
            name  = "GITHUB_ALLOWED_ORG"
            value = var.github_org
          }
          env {
            name  = "NEXTAUTH_URL"
            value = var.lore_ui_url
          }

          # Secrets — ESO-managed
          env {
            name = "LORE_DB_PASSWORD"
            value_from {
              secret_key_ref {
                name = "lore-db-password"
                key  = "password"
              }
            }
          }
          env {
            name = "GITHUB_APP_ID"
            value_from {
              secret_key_ref {
                name = "github-app-credentials"
                key  = "app-id"
              }
            }
          }
          env {
            name = "GITHUB_APP_PRIVATE_KEY"
            value_from {
              secret_key_ref {
                name = "github-app-credentials"
                key  = "private-key"
              }
            }
          }
          env {
            name = "GITHUB_APP_INSTALLATION_ID"
            value_from {
              secret_key_ref {
                name = "github-app-credentials"
                key  = "installation-id"
              }
            }
          }
          env {
            name = "GITHUB_OAUTH_CLIENT_ID"
            value_from {
              secret_key_ref {
                name = "lore-ui-oauth"
                key  = "github-oauth-client-id"
              }
            }
          }
          env {
            name = "GITHUB_OAUTH_CLIENT_SECRET"
            value_from {
              secret_key_ref {
                name = "lore-ui-oauth"
                key  = "github-oauth-client-secret"
              }
            }
          }
          env {
            name = "NEXTAUTH_SECRET"
            value_from {
              secret_key_ref {
                name = "lore-ui-oauth"
                key  = "nextauth-secret"
              }
            }
          }

          env {
            name  = "LORE_LOG_BUCKET"
            value = "lore-task-logs-${var.project_id}"
          }

          resources {
            requests = {
              cpu    = "100m"
              memory = "256Mi"
            }
            limits = {
              cpu    = "500m"
              memory = "512Mi"
            }
          }

          liveness_probe {
            http_get {
              path = "/"
              port = "http"
            }
            initial_delay_seconds = 10
            period_seconds        = 30
          }

          readiness_probe {
            http_get {
              path = "/"
              port = "http"
            }
            initial_delay_seconds = 5
            period_seconds        = 10
          }
        }
      }
    }
  }

  depends_on = [kubernetes_namespace.lore_ui]
}

resource "kubernetes_service" "lore_ui" {
  metadata {
    name      = "lore-ui"
    namespace = "lore-ui"
    labels    = { app = "lore-ui" }
  }

  spec {
    type = "ClusterIP"

    port {
      name        = "http"
      port        = 3000
      target_port = "http"
    }

    selector = { app = "lore-ui" }
  }

  depends_on = [kubernetes_namespace.lore_ui]
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

  depends_on = [
    kubernetes_namespace.lore_ui,
    kubernetes_service.lore_ui,
  ]
}
