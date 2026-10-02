# --------------------------------------------------------------------------
# The legacy webhook host (lore_webhook_hostname)
#
# Lore's own Floor served /api/webhook on this host (the ci-tests and ci-ingest
# doors). It was deleted on 2026-10-02 and its ingress went with it: CI posts
# specs, ADRs and test reports to lore-api. What stays is the alias below, in
# the `lore-floor` namespace, which is also the umbrella Helm release's home.
# --------------------------------------------------------------------------

# The legacy hook URL, kept alive. Every repo onboarded before ADR-044 step 2
# carries <lore_webhook_hostname>/api/webhook/github, and GitHub does not
# redeliver what 404s — so that path stays served, by the router: nginx
# rewrites it to the router's one front door. The alias lives in the ingress rather than as a
# second route on the router so the router keeps exactly one endpoint.
# An Ingress can only name a Service in its own namespace, hence the
# ExternalName hop. lore-api repoints hooks to the canonical URL as it touches
# them (ensure / the repo page); nothing forces the migration.
resource "kubernetes_service_v1" "lore_event_router_alias" {
  count = var.lore_webhook_hostname != "" ? 1 : 0

  metadata {
    name      = "lore-event-router"
    namespace = "lore-floor"
  }

  spec {
    type          = "ExternalName"
    external_name = "lore-event-router.lore-event-router.svc.cluster.local"
    port {
      port = 8080
    }
  }

  depends_on = [kubernetes_namespace.lore_agent]
}

resource "kubernetes_ingress_v1" "lore_floor_webhook_github" {
  count = var.lore_webhook_hostname != "" ? 1 : 0

  metadata {
    name      = "lore-floor-webhook-github"
    namespace = "lore-floor"
    annotations = {
      # This is the only ingress left on the host, so it owns the certificate
      # and the DNS record the /api/webhook ingress used to carry. The TLS secret
      # keeps its name, so cert-manager adopts the certificate already issued.
      "cert-manager.io/cluster-issuer"              = "letsencrypt-prod"
      "external-dns.alpha.kubernetes.io/hostname"   = var.lore_webhook_hostname
      "nginx.ingress.kubernetes.io/rewrite-target"  = "/api/events"
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
          path      = "/api/webhook/github"
          path_type = "Exact"
          backend {
            service {
              name = "lore-event-router"
              port {
                number = 8080
              }
            }
          }
        }
      }
    }
  }

  depends_on = [kubernetes_service_v1.lore_event_router_alias]
}
