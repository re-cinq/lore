# --------------------------------------------------------------------------
# Lore UI — ServiceAccount and Ingress
#
# The UI workload itself is deployed by the umbrella Helm release
# (`helm_release.lore_platform` in lore-platform.tf), under the `lore-ui`
# subchart key. The Workload Identity ServiceAccount and the public ingress
# remain here.
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
