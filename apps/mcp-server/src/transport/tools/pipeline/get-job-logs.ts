import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { textResult } from "../shared/deps.js";
import { cachedLogRead } from "./shared/cached-log-read.js";

const GET_JOB_LOGS_INPUT = {
  job_name: z
    .string()
    .describe("Scheduled job name, e.g. 'daily_digest' or 'spec_upkeep'."),
  run_id: z.string().describe("Run UUID from pipeline.job_runs."),
};

export function registerGetJobLogsTool(server: McpServer) {
  server.tool(
    "lore_get_job_logs",
    "Fetches the full stdout/stderr of one scheduled CronJob run (keyed by job_name + run_id), returning {logs, complete:true}. Use for scheduled jobs like daily_digest or spec_upkeep. Instead: lore_get_task_logs for a user-created pipeline task's logs (by UUID).",
    GET_JOB_LOGS_INPUT,
    async ({ job_name, run_id }) => {
      try {
        return await cachedLogRead({
          tool: "lore_get_job_logs",
          missing: "Job-run logs require LORE_API_URL.",
          path: (apiUrl) =>
            `${apiUrl}/api/job-run-logs?${new URLSearchParams({ job_name, run_id })}`,
          args: { job_name, run_id },
        });
      } catch (err) {
        return textResult(`Error getting job logs: ${errorMessage(err)}`);
      }
    },
  );
}
