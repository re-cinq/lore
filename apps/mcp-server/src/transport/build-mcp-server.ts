import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMemoryTools } from "./tools/memory/index.js";
import { registerPlanTools } from "./tools/plan/index.js";
import { registerContextTools } from "./tools/context/index.js";
import { registerPipelineTools } from "./tools/pipeline/index.js";
import { registerRepoTools } from "./tools/repo/index.js";
import { registerUsageTools } from "./tools/usage/index.js";
import { registerSpecTraceTools } from "./tools/spec-trace/index.js";
import { registerSpecTraceLocalTools } from "./tools/spec-trace/index.local.js";
import { registerUpdateTools } from "./tools/update/index.js";
import { registerCiTools } from "./tools/ci/index.js";
import { registerVersionsTools } from "./tools/versions/index.js";
import type { ServerMode } from "./tools/shared/repo-scope.js";

// Conventions that hold for every lore_ tool, stated once here instead of in each tool description to keep the always-loaded tool schema small. The session rules ride here too: the MCP client delivers instructions every session, where the systemPromptSuffix install.sh once wrote was never read.
const SERVER_INSTRUCTIONS = `Lore serves shared org context (conventions, ADRs, memories, facts, knowledge graph) plus a task pipeline to Claude Code. Tool names share the lore_ prefix as a namespace.

These hold for every lore_ tool, so individual descriptions omit them:
- Errors come back as text, never thrown.
- Every data operation is an HTTP call to LORE_API_URL (requires LORE_INGEST_TOKEN); this adapter holds no database. A few memory tools fall back to ~/.lore files when no API is configured.
- Read tools are cached; write tools invalidate the caches they touch.

Session rules:
1. First action: call lore_assemble_context with a query describing the task (one ordered bundle of conventions, ADRs, memories, facts and graph).
2. Before planning or building: call lore_search_memory, with several queries (exact terms, likely key names, broader descriptions); one empty search does not mean nothing exists.
3. During work: lore_search_context for patterns and history, lore_query_graph for entity relationships.
4. Before the session ends: lore_write_memory with key "session-summary/{repo}/{date}" for decisions, corrections and non-obvious learnings, and lore_write_episode with raw observations.
5. Self-update: when lore_assemble_context output contains "lore_mcp_update_available", or the session started with "[lore] Your Lore MCP is behind the deployed version", tell the user and offer lore_update. Call lore_update ONLY after the user agrees; they restart Claude Code afterwards. lore_versions shows which build of every Lore part runs.

For full return shapes, path-specific argument behavior, and a "choosing between similar tools" matrix, see docs/mcp-tools-reference.md.`;

export type { ServerMode };

// Builds the McpServer; in `agent` mode the pipeline tools, local spec-trace runners, and lore_update are NOT registered.
export function buildMcpServer(
  opts: { serverMode?: ServerMode } = {},
): McpServer {
  const server = new McpServer(
    { name: "@re-cinq/lore-mcp", version: process.env.LORE_BUILD_SHA || "dev" },
    { instructions: SERVER_INSTRUCTIONS },
  );
  const serverMode = opts.serverMode ?? resolveServerMode();

  registerSharedTools(server, serverMode);

  if (serverMode !== "agent") {
    registerLaptopOnlyTools(server);
  }

  return server;
}

// `agent` mode (the shared HTTP gateway for headless agent pods) omits tools that only make sense on a developer's machine or let an agent spawn more work.
function resolveServerMode(): ServerMode {
  return process.env.LORE_MCP_SERVER_MODE === "agent" ? "agent" : "full";
}

function registerSharedTools(server: McpServer, mode: ServerMode): void {
  registerContextTools(server, mode);
  registerMemoryTools(server, mode);
  registerPlanTools(server);
  registerSpecTraceTools(server, mode);
  registerUsageTools(server);
  registerRepoTools(server, mode);
  registerCiTools(server, mode);
  registerVersionsTools(server);
}

// Registered only outside `agent` mode: they need a developer's own machine.
function registerLaptopOnlyTools(server: McpServer): void {
  registerPipelineTools(server);
  registerSpecTraceLocalTools(server);
  // lore_update rebuilds ~/.re-cinq/lore, a laptop-only checkout the gateway's agent pods do not have.
  registerUpdateTools(server);
}
