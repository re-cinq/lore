# --------------------------------------------------------------------------
# ConfigMaps — task-types.yaml for agent and MCP server
#
# Both agent_config and mcp_config are managed by the umbrella Helm release
# (helm_release.lore_platform, lore-floor/lore-api subcharts). Do not define
# them here — Helm requires ownership labels and will refuse to adopt a
# ConfigMap already managed by another controller.
# --------------------------------------------------------------------------
