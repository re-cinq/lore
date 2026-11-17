import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { queryString, readRun, runPath } from "./shared/run-read.js";
import { RUN_ID } from "./shared/run-params.js";

export const GET_RUN_TRANSCRIPT_DESCRIPTION =
  "Reads an assembly-line run's agent turns, oldest first, a page at a time, returning {turns, hasMore}; pass the last turn's id as after for the next page. With visit_id it returns that one visit's events instead, {events}. Instead: lore_get_run_node_logs for a visit's raw log.";

const GET_RUN_TRANSCRIPT_INPUT = {
  run_id: RUN_ID,
  visit_id: z
    .string()
    .min(1)
    .optional()
    .describe("Read this visit's events instead of the run's turns."),
  after: z
    .string()
    .optional()
    .describe("The id of the last turn already read."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Turns per page."),
};

type TranscriptArgs = {
  run_id: string;
  visit_id?: string;
  after?: string;
  limit?: number;
};

export function registerGetRunTranscriptTool(server: McpServer) {
  server.tool(
    "lore_get_run_transcript",
    GET_RUN_TRANSCRIPT_DESCRIPTION,
    GET_RUN_TRANSCRIPT_INPUT,
    (args) =>
      readRun({
        tool: "lore_get_run_transcript",
        op: "getting run transcript",
        load: (get) => get(transcriptPath(args)),
      }),
  );
}

function transcriptPath({
  run_id,
  visit_id,
  after,
  limit,
}: TranscriptArgs): string {
  if (visit_id) {
    return runPath(run_id, `/visits/${encodeURIComponent(visit_id)}/events`);
  }

  return runPath(run_id, `/turns${queryString({ after, limit })}`);
}
