/**
 * @re-cinq/lore-server-core — light shared server logic imported by both the
 * local MCP adapter (apps/mcp-server) and the remote HTTPS API. Granular
 * modules are reached via subpath exports (e.g.
 * `@re-cinq/lore-server-core/features/memory/memory.js`); this barrel re-exports
 * the proxy client as the package root.
 */
export * from "./proxy.js";
