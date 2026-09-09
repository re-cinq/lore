# --------------------------------------------------------------------------
# Lore Floor — /api/webhook ingress
#
# The Floor workload itself is deployed by the umbrella Helm release
# (`helm_release.lore_platform` in lore-platform.tf), under the `lore-floor`
# subchart key. Only the ingress remains here.
# --------------------------------------------------------------------------

# External ingress for the Floor's CI doors. Created only when a webhook hostname
# is configured; routes the /api/webhook prefix — ci-tests and ci-ingest (bearer
# ingest-token) — to the Floor HTTP server. /healthz stays cluster-internal;
# /api/agent-events has its own ingress (lore-agent-events.tf) so satellite
# telemetry does not ride the same door. GitHub's own deliveries no longer land
# on the Floor: the canonical hook URL is the event-router (ADR-044), and the
# legacy /api/webhook/github path is aliased onto it below.
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

# The legacy hook URL, kept alive. Every repo onboarded before ADR-044 step 2
# carries <lore_webhook_hostname>/api/webhook/github, and GitHub does not
# redeliver what 404s — so that path stays served, by the router: the Exact
# match outranks the /api/webhook prefix above, and nginx rewrites it to the
# router's one front door. The alias lives in the ingress rather than as a
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
      # cert-manager / external-dns stay on lore_floor_webhook: nginx merges
      # rules per host, and the TLS secret declared there covers this rule too.
      "nginx.ingress.kubernetes.io/rewrite-target"  = "/api/events"
      "nginx.ingress.kubernetes.io/proxy-body-size" = "25m"
    }
  }

  spec {
    ingress_class_name = "nginx-ingress"
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
