# --------------------------------------------------------------------------
# Lore Floor — agent-telemetry ingress
#
# The Floor's `POST /api/agent-events` is the sink every agent and station pod
# streams its NDJSON run output to: cost accounting into `pipeline.llm_calls`,
# and the per-tool-call projection behind the live run view
# (`pipeline.agent_run_events`, ADR-037).
#
# Central-cluster pods reach it over in-cluster DNS and never touch this
# ingress. It exists for SATELLITES (specs/running-stations-in-any-k8s-cluster):
# a registered cluster-agent runs pods in a cluster Lore does not own, so
# without a public door their runs report only a terminal outcome — no cost
# rows, no live view. The route authenticates them by their own per-agent
# token (matched against `pipeline.cluster_agents`), never the bus-wide
# `LORE_AGENT_INTERNAL_TOKEN`, which is why exposing it does not hand a
# satellite anything it could not already do.
#
# Its OWN ingress rather than another path on `lore_floor_webhook`: that door
# carries GitHub's HMAC-verified control-plane traffic and this is data-plane
# telemetry from a different set of callers with a different credential. Every
# other service here (lore-api, event-router, lore-mcp, lore-ui) is likewise
# one ingress, one purpose.
#
# Empty hostname disables it entirely — the pre-satellite behaviour.
# --------------------------------------------------------------------------

resource "kubernetes_ingress_v1" "lore_agent_events" {
  count = var.lore_agent_events_hostname != "" ? 1 : 0

  metadata {
    name      = "lore-agent-events"
    namespace = "lore-floor"
    annotations = {
      "cert-manager.io/cluster-issuer"            = "letsencrypt-prod"
      "external-dns.alpha.kubernetes.io/hostname" = var.lore_agent_events_hostname
      # Per-source-IP request cap. This is the platform's only INGRESS-level
      # rate limit — lore-api's is an in-app sliding window (ADR-033) — and
      # the difference is deliberate: the Floor carries no such plugin, and a
      # newly public data-plane door should not wait for one. A satellite
      # posts one batch per run tick rather than per tool call, so this is
      # generous; raise it if a real fleet ever proves otherwise.
      "nginx.ingress.kubernetes.io/limit-rps" = "20"
      # Matches the Floor's own MAX_BODY_BYTES; the handler's 8MB viz gate
      # degrades gracefully above that rather than refusing.
      "nginx.ingress.kubernetes.io/proxy-body-size" = "25m"
    }
  }

  spec {
    ingress_class_name = "nginx-ingress"
    tls {
      hosts       = [var.lore_agent_events_hostname]
      secret_name = "lore-agent-events-tls"
    }
    rule {
      host = var.lore_agent_events_hostname
      http {
        path {
          path      = "/api/agent-events"
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
