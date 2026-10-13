# What the external floor's agent pods need from Lore's side of the cluster.

# A floor agent's pod may reach DNS, the public internet on 443 and its own floor —
# nothing else in the cluster. Lore's definitions name the lore-mcp gateway for the
# pod's MCP server and its skills registry, both in-cluster, so without this rule the
# pod's init hangs fetching skills and the agent runs with no Lore tools. Policies
# add up: this one selects the same pods the floor's own policy does and opens one
# more door, the way agent-job-egress does for Lore's own agents namespace.
resource "kubectl_manifest" "floor_agent_lore_mcp_egress" {
  count = var.enable_external_floor ? 1 : 0

  yaml_body = yamlencode({
    apiVersion = "networking.k8s.io/v1"
    kind       = "NetworkPolicy"
    metadata = {
      name      = "floor-agent-lore-mcp-egress"
      namespace = "floor"
    }
    spec = {
      podSelector = {
        matchLabels = { "agents.re-cinq.com/component" = "job" }
      }
      policyTypes = ["Egress"]
      egress = [
        {
          to = [
            {
              namespaceSelector = {
                matchLabels = { "kubernetes.io/metadata.name" = "lore-api" }
              }
              podSelector = { matchLabels = { app = "lore-mcp-gateway" } }
            },
          ]
          ports = [{ protocol = "TCP", port = 8080 }]
        },
      ]
    }
  })
}
