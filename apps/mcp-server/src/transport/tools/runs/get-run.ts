import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type ApiGet, readParts, readRun, runPath } from "./shared/run-read.js";
import { RUN_ID } from "./shared/run-params.js";

export const GET_RUN_DESCRIPTION =
  "Reads one assembly-line run by id, returning {run, nodes, dod, token_usage}: the run with the graph it walked, each station visit in order with its state and error, Definition of Done progress and tokens spent. A part the run lacks comes back as {error}. Instead: lore_get_run_node_logs for one visit's log, lore_get_run_transcript for the agent turns.";

export function registerGetRunTool(server: McpServer) {
  server.tool(
    "lore_get_run",
    GET_RUN_DESCRIPTION,
    { run_id: RUN_ID },
    ({ run_id }) =>
      readRun({
        tool: "lore_get_run",
        op: "getting run",
        load: (get) => runState(get, run_id),
      }),
  );
}

function runState(get: ApiGet, runId: string) {
  return readParts(get, {
    required: { run: runPath(runId) },
    optional: {
      nodes: runPath(runId, "/nodes"),
      dod: runPath(runId, "/dod"),
      token_usage: runPath(runId, "/token-usage"),
    },
  });
}
