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
# redeliver what 404s — so that path stays served, by lore-api, whose own
# route has that very path (no rewrite). An Ingress can only name a Service in
# its own namespace, hence the ExternalName hop. lore-api repoints hooks to the
# canonical URL as it touches them (ensure / the repo page); nothing forces
# the migration.
resource "kubernetes_service_v1" "lore_api_webhook_alias_legacy" {
  count = var.lore_webhook_hostname != "" ? 1 : 0

  metadata {
    name      = "lore-api-webhook"
    namespace = "lore-floor"
  }

  spec {
    type          = "ExternalName"
    external_name = "lore-api.lore-api.svc.cluster.local"
    port {
      port = 3000
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

  depends_on = [kubernetes_service_v1.lore_api_webhook_alias_legacy]
}
