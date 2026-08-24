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
# CUTOVER — the order matters and is not reversible without dropping deliveries:
#   1. Apply this, so the router is standing and answering on its own host.
#   2. Re-point every repo's webhook at <lore_event_router_hostname>/api/events
#      (the `/webhook/ensure` mechanism used for the 2026-08 rollout).
#   3. ONLY THEN retire the Floor's own /api/webhook ingress and route.
# Deleting the Floor's route before step 2 leaves deliveries 404ing at a host
# nothing serves, and GitHub does not redeliver indefinitely.
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
