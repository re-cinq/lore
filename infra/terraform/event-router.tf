# --------------------------------------------------------------------------
# Lore Event Router — GitHub webhook ingress (ADR-044)
#
# The workload itself is deployed by the umbrella Helm release
# (`helm_release.lore_platform` in lore-platform.tf) under the
# `lore-event-router` subchart, as a ClusterIP Service on :8080 in the
# lore-event-router namespace. Like every other ingress, the public one lives
# here.
#
# Only GitHub reaches the router from outside. Every other producer (the Floor,
# lore-api) is an ordinary in-cluster Deployment and uses the ClusterIP via
# `local.event_router_in_cluster`.
#
# CUTOVER (done 2026-09-08): the Floor's /api/webhook/github route is gone, and
# lore-api installs hooks at <lore_event_router_hostname>/api/events. Repos not
# yet re-pointed keep delivering to the old URL, which the Floor ingress
# rewrites onto this Service (see lore-floor.tf) — so a hook is never wrong,
# only legacy, and GitHub never 404s a delivery it would not redeliver.
#
# The path is `/api/events`, not `/api/webhook/github`: the router has one front
# door and GitHub is simply one of the callers through it.
# --------------------------------------------------------------------------

resource "kubernetes_ingress_v1" "lore_event_router" {
  count = var.lore_event_router_hostname != "" ? 1 : 0

  metadata {
    name      = "lore-event-router"
    namespace = "lore-event-router"
    annotations = {
      "cert-manager.io/cluster-issuer"            = "letsencrypt-prod"
      "external-dns.alpha.kubernetes.io/hostname" = var.lore_event_router_hostname
      # A GitHub push delivery can reach 25MB; nginx's 1MB default would refuse
      # it before the router ever verifies the signature.
      "nginx.ingress.kubernetes.io/proxy-body-size" = "25m"
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
          path_type = "Prefix"
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

  depends_on = [kubernetes_namespace.lore_event_router]
}
