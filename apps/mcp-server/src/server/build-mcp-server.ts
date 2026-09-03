import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMemoryTools } from "../mcp/tools/memory-tools.js";
import { registerContextTools } from "../mcp/tools/context-tools.js";
import { registerPipelineTools } from "../mcp/tools/pipeline-tools.js";
import { registerRepoTools } from "../mcp/tools/repo-tools.js";
import { registerUsageTools } from "../mcp/tools/usage-tools.js";
import { registerSpecTraceTools } from "../mcp/tools/spec-trace-tools.js";
import { registerLocalRunnerTools } from "../mcp/tools/local-runner-tools.local.js";
import { registerSpecTraceLocalTools } from "../mcp/tools/spec-trace-tools.local.js";
import { registerUpdateTools } from "../mcp/tools/update-tools.js";

// Conventions that hold for every lore_ tool, stated once here instead of in each tool description to keep the always-loaded tool schema small.
const SERVER_INSTRUCTIONS = `Lore serves shared org context (conventions, ADRs, memories, facts, knowledge graph) plus a task pipeline to Claude Code. Tool names share the lore_ prefix as a namespace.

These hold for every lore_ tool, so individual descriptions omit them:
- Errors come back as text, never thrown.
- Every data operation is an HTTP call to LORE_API_URL (requires LORE_INGEST_TOKEN); this adapter holds no database. A few memory tools fall back to ~/.lore files when no API is configured.
- Read tools are cached; write tools invalidate the caches they touch.

Start a task with lore_assemble_context (one ordered bundle), then lore_search_memory for prior learnings. For full return shapes, path-specific argument behavior, and a "choosing between similar tools" matrix, see docs/mcp-tools-reference.md.`;

export type ServerMode = "full" | "agent";

// `agent` mode (the shared HTTP gateway for headless agent pods) omits tools that only make sense on a developer's machine or let an agent spawn more work.
function resolveServerMode(): ServerMode {
  return process.env.LORE_MCP_SERVER_MODE === "agent" ? "agent" : "full";
}

// Builds the McpServer; in `agent` mode the pipeline tools (lore_create_pipeline_task, the recursion vector), local-runner tools, local spec-trace runners, and lore_update are NOT registered.
export function buildMcpServer(
  opts: { serverMode?: ServerMode } = {},
): McpServer {
  const server = new McpServer(
    { name: "@re-cinq/lore-mcp", version: "0.1.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );
  const serverMode = opts.serverMode ?? resolveServerMode();

  registerContextTools(server);
  registerMemoryTools(server);
  registerSpecTraceTools(server);
  registerUsageTools(server);
  registerRepoTools(server);

  if (serverMode !== "agent") {
    registerPipelineTools(server);
    registerLocalRunnerTools(server);
    registerSpecTraceLocalTools(server);
    // lore_update rebuilds ~/.re-cinq/lore, a laptop-only checkout the gateway's agent pods do not have.
    registerUpdateTools(server);
  }

  return server;
}
