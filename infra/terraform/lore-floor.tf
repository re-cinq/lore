# --------------------------------------------------------------------------
# Lore Floor — webhook ingress
#
# The Floor workload itself is deployed by the umbrella Helm release
# (`helm_release.lore_platform` in lore-platform.tf), under the `lore-floor`
# subchart key. Only the webhook ingress remains here.
# --------------------------------------------------------------------------

# External ingress for the Floor webhook routes (the ingress moved from mcp-server
# into the Floor). Created only when a webhook hostname is configured; routes the
# whole `/api/webhook` prefix to the Floor HTTP server so every webhook route it
# exposes is reachable — `github` (HMAC-verified), plus the CI doc/test ingresses
# `ci-ingest` (specs/ADRs → graph) and `ci-tests` (bearer-token). A path scoped to
# `/api/webhook/github` alone silently 404'd ci-ingest, so specs/ADRs pushed after
# the CI-projection cutover never reached the graph. Each route authenticates
# in-process, so the broader prefix grants no access the handlers don't gate.
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
          path      = "/api/webhook"
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
