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

export type ServerMode = "full" | "agent";

/**
 * `agent` mode is for the shared HTTP gateway that serves headless agent pods:
 * it omits tools that only make sense on a developer's machine or that let an
 * agent spawn more work. Everything read/context/memory/search stays.
 */
function resolveServerMode(): ServerMode {
  return process.env.LORE_MCP_SERVER_MODE === "agent" ? "agent" : "full";
}

/**
 * Build the McpServer and register every feature's tools. The DB pool is
 * read lazily through deps.getPool because main() creates it after this.
 *
 * `serverMode` defaults to LORE_MCP_SERVER_MODE. In `agent` mode the pipeline
 * tools (lore_create_pipeline_task — the recursion vector), the local-runner
 * tools (laptop-only worktree spawning) and the local spec-trace runners are
 * NOT registered.
 */
export function buildMcpServer(
  deps: ToolDeps,
  opts: { serverMode?: ServerMode } = {},
): McpServer {
  const server = new McpServer(
    { name: "@re-cinq/lore-mcp", version: "0.1.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );
  const serverMode = opts.serverMode ?? resolveServerMode();

  registerContextTools(server, deps);
  registerMemoryTools(server, deps);
  registerSpecTraceTools(server, deps);
  registerUsageTools(server, deps);
  registerRepoTools(server, deps);

  if (serverMode !== "agent") {
    registerPipelineTools(server, deps);
    registerLocalRunnerTools(server, deps);
    registerSpecTraceLocalTools(server, deps);
  }

  return server;
}
