import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMemoryTools } from "./tools/memory/index.js";
import { registerPlanTools } from "./tools/plan/index.js";
import { registerContextTools } from "./tools/context/index.js";
import { registerPipelineTools } from "./tools/pipeline/index.js";
import { registerRepoTools } from "./tools/repo/index.js";
import { registerUsageTools } from "./tools/usage/index.js";
import { registerSpecTraceTools } from "./tools/spec-trace/index.js";
import { registerLocalRunnerTools } from "./tools/local-runner/index.local.js";
import { registerSpecTraceLocalTools } from "./tools/spec-trace/index.local.js";
import { registerUpdateTools } from "./tools/update/index.js";
import { registerCiTools } from "./tools/ci/index.js";
import type { ServerMode } from "./tools/shared/repo-scope.js";

// Conventions that hold for every lore_ tool, stated once here instead of in each tool description to keep the always-loaded tool schema small.
const SERVER_INSTRUCTIONS = `Lore serves shared org context (conventions, ADRs, memories, facts, knowledge graph) plus a task pipeline to Claude Code. Tool names share the lore_ prefix as a namespace.

These hold for every lore_ tool, so individual descriptions omit them:
- Errors come back as text, never thrown.
- Every data operation is an HTTP call to LORE_API_URL (requires LORE_INGEST_TOKEN); this adapter holds no database. A few memory tools fall back to ~/.lore files when no API is configured.
- Read tools are cached; write tools invalidate the caches they touch.

Start a task with lore_assemble_context (one ordered bundle), then lore_search_memory for prior learnings. For full return shapes, path-specific argument behavior, and a "choosing between similar tools" matrix, see docs/mcp-tools-reference.md.`;

export type { ServerMode };

// Builds the McpServer; in `agent` mode the pipeline tools, local-runner tools, local spec-trace runners, and lore_update are NOT registered.
export function buildMcpServer(
  opts: { serverMode?: ServerMode } = {},
): McpServer {
  const server = new McpServer(
    { name: "@re-cinq/lore-mcp", version: "0.1.0" },
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
}

// Registered only outside `agent` mode: they need a developer's own machine.
function registerLaptopOnlyTools(server: McpServer): void {
  registerPipelineTools(server);
  registerLocalRunnerTools(server);
  registerSpecTraceLocalTools(server);
  // lore_update rebuilds ~/.re-cinq/lore, a laptop-only checkout the gateway's agent pods do not have.
  registerUpdateTools(server);
}
