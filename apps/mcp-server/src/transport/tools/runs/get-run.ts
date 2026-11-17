import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type ApiGet, readParts, readRun, runPath } from "./shared/run-read.js";
import { RUN_ID } from "./shared/run-params.js";

export const GET_RUN_DESCRIPTION =
  "Reads one assembly-line run by id, returning {run, dod}: run.line is the run with its status and the graph it walked, run.nodes each station visit in order with its state, error and agentCrName, and dod the Definition of Done progress, {error} for a run without one. Instead: lore_get_run_node_logs for one visit's log, lore_get_run_transcript for the agent turns, lore_list_runs for the run's cost.";

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
    optional: { dod: runPath(runId, "/dod") },
  });
}
