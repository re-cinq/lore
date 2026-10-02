# --------------------------------------------------------------------------
# The GitHub webhook hostname (lore_event_router_hostname)
#
# This host carried the event-router's one front door until 2026-10-02 (ADR-044
# and its amendment). The router is deleted; lore-api serves GitHub's
# deliveries at `POST /api/webhook/github`. The hostname and the `/api/events`
# path do not change, so no repository's hook is registered again: nginx
# rewrites the public path onto lore-api's route.
#
# The ingress lives in the lore-api namespace, beside the Service it names.
# Its certificate is a Certificate resource rather than the usual
# cert-manager annotation, so it can be issued BEFORE the ingress moves here:
# an ingress that arrives with no certificate serves nginx's default one for
# as long as issuance takes, and GitHub does not redeliver what fails TLS.
# Apply this file in two steps (see the pull request that introduced it):
# the certificate first, the rest once it is Ready.
# --------------------------------------------------------------------------

resource "kubectl_manifest" "lore_webhook_certificate" {
  count = var.lore_event_router_hostname != "" ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "cert-manager.io/v1"
    kind       = "Certificate"
    metadata = {
      name      = "lore-webhook"
      namespace = "lore-api"
    }
    spec = {
      secretName = "lore-webhook-tls"
      dnsNames   = [var.lore_event_router_hostname]
      issuerRef = {
        kind = "ClusterIssuer"
        name = "letsencrypt-prod"
      }
    }
  })

  depends_on = [kubernetes_namespace.lore_api]
}

resource "kubernetes_ingress_v1" "lore_webhook" {
  count = var.lore_event_router_hostname != "" ? 1 : 0

  metadata {
    name      = "lore-webhook"
    namespace = "lore-api"
    annotations = {
      "external-dns.alpha.kubernetes.io/hostname" = var.lore_event_router_hostname
      # A GitHub push delivery can reach 25MB; nginx's 1MB default would refuse
      # it before lore-api ever verifies the signature.
      "nginx.ingress.kubernetes.io/proxy-body-size" = "25m"
      "nginx.ingress.kubernetes.io/rewrite-target"  = "/api/webhook/github"
    }
  }

  spec {
    ingress_class_name = "nginx-ingress"
    tls {
      hosts       = [var.lore_event_router_hostname]
      secret_name = "lore-webhook-tls"
    }
    rule {
      host = var.lore_event_router_hostname
      http {
        path {
          path      = "/api/events"
          path_type = "Exact"
          backend {
            service {
              name = "lore-api"
              port {
                number = 3000
              }
            }
          }
        }
      }
    }
  }

  depends_on = [kubectl_manifest.lore_webhook_certificate]
}
