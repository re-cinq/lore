# --------------------------------------------------------------------------
# The GitHub webhook hostname (lore_event_router_hostname)
#
# Step 1 of moving this ingress out of the event-router's namespace: the
# certificate for the hostname is issued in the lore-api namespace BEFORE the
# ingress moves there. An ingress that arrives with no certificate serves
# nginx's default one for as long as issuance takes, and GitHub does not
# redeliver a delivery that fails TLS. Step 2 recreates the ingress beside
# lore-api and removes the event-router namespace.
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

resource "kubernetes_service_v1" "lore_api_webhook_alias" {
  count = var.lore_event_router_hostname != "" ? 1 : 0

  metadata {
    name      = "lore-api-webhook"
    namespace = "lore-event-router"
  }

  spec {
    type          = "ExternalName"
    external_name = "lore-api.lore-api.svc.cluster.local"
    port {
      port = 3000
    }
  }

  depends_on = [kubernetes_namespace.lore_event_router]
}

resource "kubernetes_ingress_v1" "lore_event_router" {
  count = var.lore_event_router_hostname != "" ? 1 : 0

  metadata {
    name      = "lore-event-router"
    namespace = "lore-event-router"
    annotations = {
      "cert-manager.io/cluster-issuer"            = "letsencrypt-prod"
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
      secret_name = "lore-event-router-tls"
    }
    rule {
      host = var.lore_event_router_hostname
      http {
        path {
          path      = "/api/events"
          path_type = "Exact"
          backend {
            service {
              name = "lore-api-webhook"
              port {
                number = 3000
              }
            }
          }
        }
      }
    }
  }

  depends_on = [kubernetes_service_v1.lore_api_webhook_alias]
}
