# --------------------------------------------------------------------------
# ConfigMaps — task-types.yaml for agent and MCP server
# --------------------------------------------------------------------------

resource "kubernetes_config_map" "agent_config" {
  metadata {
    name      = "lore-agent-config"
    namespace = "lore-agent"
  }

  data = {
    "task-types.yaml" = file("${path.module}/../scripts/task-types.yaml")
  }

  depends_on = [kubernetes_namespace.lore_agent]
}

# mcp_config is managed by the Helm chart (helm_release.lore_mcp)
# Do not define it here — Helm requires ownership labels.
