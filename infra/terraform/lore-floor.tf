# --------------------------------------------------------------------------
# Lore Floor — GitHub webhook ingress
#
# The Floor workload itself is deployed by the umbrella Helm release
# (`helm_release.lore_platform` in lore-platform.tf), under the `lore-floor`
# subchart key. Only the webhook ingress remains here.
# --------------------------------------------------------------------------

# External ingress for the Floor webhook hooks (the ingress moved from mcp-server
# into the Floor). Created only when a webhook hostname is configured; routes the
# /api/webhook prefix — github (HMAC-verified in-process), ci-tests and ci-ingest
# (bearer ingest-token) — to the Floor HTTP server. /healthz stays
# cluster-internal; /api/agent-events has its own ingress (lore-agent-events.tf)
# so satellite telemetry does not ride the same door as GitHub's webhooks.
# Operator step after apply: repoint the GitHub App / org webhook to this host.
resource "kubernetes_ingress_v1" "lore_floor_webhook" {
  count = var.lore_webhook_hostname != "" ? 1 : 0

  metadata {
    name      = "lore-floor-webhook"
    namespace = "lore-floor"
    annotations = {
      "cert-manager.io/cluster-issuer"            = "letsencrypt-prod"
      "external-dns.alpha.kubernetes.io/hostname" = var.lore_webhook_hostname
      # NGINX defaults to a 1 MB body, while the Floor's own server accepts 25 MB
      # (GitHub caps webhook deliveries there) — so without this the edge rejects
      # a delivery the app was built to take. It also bounds the ci-tests ingest
      # POST, which rides this same /api/webhook prefix: the 4 MB chunks this
      # branch introduces would 413 before reaching hapi. Matches the
      # event-router and agent-events ingresses, which already carry it.
      "nginx.ingress.kubernetes.io/proxy-body-size" = "25m"
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
