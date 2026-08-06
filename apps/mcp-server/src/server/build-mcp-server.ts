import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolDeps } from "../mcp/tools/deps.js";
import { registerMemoryTools } from "../mcp/tools/memory-tools.js";
import { registerContextTools } from "../mcp/tools/context-tools.js";
import { registerPipelineTools } from "../mcp/tools/pipeline-tools.js";
import { registerRepoTools } from "../mcp/tools/repo-tools.js";
import { registerUsageTools } from "../mcp/tools/usage-tools.js";
import { registerSpecTraceTools } from "../mcp/tools/spec-trace-tools.js";
import { registerLocalRunnerTools } from "../mcp/tools/local-runner-tools.local.js";
import { registerSpecTraceLocalTools } from "../mcp/tools/spec-trace-tools.local.js";
import { registerUpdateTools } from "../mcp/tools/update-tools.js";

/**
 * Conventions that hold for every lore_ tool. Stated once here instead of
 * repeated in each tool description, which keeps the always-loaded tool
 * schema small. Per-tool descriptions cover only what to select and when.
 */
const SERVER_INSTRUCTIONS = `Lore serves shared org context (conventions, ADRs, memories, facts, knowledge graph) plus a task pipeline to Claude Code. Tool names share the lore_ prefix as a namespace.

These hold for every lore_ tool, so individual descriptions omit them:
- Errors come back as text, never thrown.
- Transport is automatic: a direct Postgres connection when LORE_DB_HOST is set, otherwise an HTTP proxy to LORE_API_URL (requires LORE_INGEST_TOKEN). Some tools are DB-only (no proxy path) and note it; a few memory tools fall back to ~/.lore files when no API is configured.
- Read tools are cached; write tools invalidate the caches they touch.

Start a task with lore_assemble_context (one ordered bundle), then lore_search_memory for prior learnings. For full return shapes, path-specific argument behavior, and a "choosing between similar tools" matrix, see docs/mcp-tools-reference.md.`;

/**
 * Build the McpServer and register every feature's tools. The DB pool is
 * read lazily through deps.getPool because main() creates it after this.
 */
export function buildMcpServer(deps: ToolDeps): McpServer {
  const server = new McpServer(
    { name: "@re-cinq/lore-mcp", version: "0.1.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerContextTools(server, deps);
  registerMemoryTools(server, deps);
  registerSpecTraceTools(server, deps);
  registerPipelineTools(server, deps);
  registerUsageTools(server, deps);
  registerRepoTools(server, deps);
  registerLocalRunnerTools(server, deps);
  registerSpecTraceLocalTools(server, deps);
  registerUpdateTools(server, deps);

  return server;
}
