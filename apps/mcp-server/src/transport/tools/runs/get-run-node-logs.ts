import { apiSegment, idParam } from "../shared/api-segment.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readRun, runPath } from "./shared/run-read.js";
import { RUN_ID } from "./shared/run-params.js";

export const GET_RUN_NODE_LOGS_DESCRIPTION =
  "Reads one station visit's log from an assembly-line run, returning {available, logs, phase, archived}. node is a visit's agent_cr_name from lore_get_run's visits (floor-<visitId> on the external floor). Pass tail to read only the last lines. Instead: lore_get_run_transcript for the agent's turns, lore_get_task_logs for a pipeline task.";

const GET_RUN_NODE_LOGS_INPUT = {
  run_id: RUN_ID,
  node: idParam.describe("The visit's node name, e.g. floor-<visitId>."),
  tail: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Return only the last N lines."),
};

export function registerGetRunNodeLogsTool(server: McpServer) {
  server.tool(
    "lore_get_run_node_logs",
    GET_RUN_NODE_LOGS_DESCRIPTION,
    GET_RUN_NODE_LOGS_INPUT,
    ({ run_id, node, tail }) =>
      readRun({
        tool: "lore_get_run_node_logs",
        op: "getting node logs",
        load: (get) =>
          get(
            runPath(
              run_id,
              `/nodes/${apiSegment(node)}/logs${tail ? `?tail=${tail}` : ""}`,
            ),
          ),
      }),
  );
}
