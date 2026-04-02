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

resource "kubernetes_config_map" "mcp_config" {
  metadata {
    name      = "lore-mcp-config"
    namespace = "mcp-servers"
  }

  data = {
    "task-types.yaml" = file("${path.module}/../scripts/task-types.yaml")
  }

  depends_on = [kubernetes_namespace.mcp_servers]
}
