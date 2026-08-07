# --------------------------------------------------------------------------
# Lore MCP gateway — public Ingress
#
# The gateway workload itself is deployed by the umbrella Helm release
# (`helm_release.lore_platform` in lore-platform.tf) under the `lore-mcp`
# subchart, as a ClusterIP Service `lore-mcp:8080` in the `lore-api`
# namespace. Like the lore-api / lore-ui / lore-floor-webhook ingresses, the
# public ingress lives here (ingresses are Terraform-owned).
#
# Agent pods reach this host over public :443 (their NetworkPolicy allows only
# public :443 egress — in-cluster ClusterIPs are blocked), presenting the
# `lore-mcp-auth` bearer the gateway validates. The gateway itself is a normal
# Deployment (not under agent-job-egress), so gateway->lore-api uses the
# in-cluster ClusterIP.
#
# Host is derived from lore_mcp_url (the URL the agent recipes' mcp_servers
# entry already points at) so there is no second hostname var to keep in sync.
# A single "/" Prefix routes the MCP endpoint (/mcp) and /healthz.
# --------------------------------------------------------------------------

locals {
  # Strip the scheme: "https://lore-mcp.gcp.re-cinq.com" -> "lore-mcp.gcp.re-cinq.com"
  lore_mcp_hostname = trimprefix(trimprefix(var.lore_mcp_url, "https://"), "http://")
}

resource "kubernetes_ingress_v1" "lore_mcp" {
  count = var.lore_mcp_url != "" ? 1 : 0

  metadata {
    name      = "lore-mcp"
    namespace = "lore-api"

    annotations = {
      "cert-manager.io/cluster-issuer"            = "letsencrypt-prod"
      "external-dns.alpha.kubernetes.io/hostname" = local.lore_mcp_hostname
    }
  }

  spec {
    ingress_class_name = "nginx-ingress"

    tls {
      hosts       = [local.lore_mcp_hostname]
      secret_name = "lore-mcp-tls"
    }

    rule {
      host = local.lore_mcp_hostname

      http {
        path {
          path      = "/"
          path_type = "Prefix"

          backend {
            service {
              # The gateway Service is named after its chart (lore-mcp-gateway),
              # renamed off `lore-mcp` to dodge the umbrella's orphaned stored block.
              name = "lore-mcp-gateway"
              port {
                number = 8080
              }
            }
          }
        }
      }
    }
  }

  depends_on = [kubernetes_namespace.lore_api]
}
