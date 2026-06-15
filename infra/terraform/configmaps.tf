# --------------------------------------------------------------------------
# ConfigMaps — task-types.yaml for agent and MCP server
#
# Both agent_config and mcp_config are managed by their respective Helm
# charts (helm_release.lore_agent, helm_release.lore_mcp). Do not define
# them here — Helm requires ownership labels and will refuse to adopt a
# ConfigMap already managed by another controller.
# --------------------------------------------------------------------------
