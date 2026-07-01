# --------------------------------------------------------------------------
# Lore API — public Ingress
#
# The API workload itself is deployed by the umbrella Helm release
# (`helm_release.lore_platform` in lore-platform.tf) under the `lore-api`
# subchart key, as a ClusterIP Service `lore-api:3000` in the `lore-api`
# namespace. The public ingress lives here (ingresses are Terraform-owned,
# like lore_ui and lore_floor_webhook).
#
# Restores the ingress dropped in the #753 umbrella consolidation (which
# deleted infra/k8s/lore-mcp-ingress.yaml but only re-added the UI one), so
# `lore_api_url` resolves again for local adapters + the CI workflows that
# hit it (smoke, ingest, onboard, lore-tests /dist, trace-impact).
#
# Host is derived from lore_api_url (the URL callers already use) so there is
# no second hostname var to keep in sync. A single "/" Prefix routes every
# API path — /api (bearer-auth-gated), /healthz, and /dist.
# --------------------------------------------------------------------------

locals {
  # Strip the scheme: "https://lore-api.gcp.re-cinq.com" -> "lore-api.gcp.re-cinq.com"
  lore_api_hostname = trimprefix(trimprefix(var.lore_api_url, "https://"), "http://")
}

resource "kubernetes_ingress_v1" "lore_api" {
  count = var.lore_api_url != "" ? 1 : 0

  metadata {
    name      = "lore-api"
    namespace = "lore-api"

    annotations = {
      "cert-manager.io/cluster-issuer"            = "letsencrypt-prod"
      "external-dns.alpha.kubernetes.io/hostname" = local.lore_api_hostname
    }
  }

  spec {
    ingress_class_name = "nginx-ingress"

    tls {
      hosts       = [local.lore_api_hostname]
      secret_name = "lore-api-tls"
    }

    rule {
      host = local.lore_api_hostname

      http {
        path {
          path      = "/"
          path_type = "Prefix"

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

  depends_on = [kubernetes_namespace.lore_api]
}
