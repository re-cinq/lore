import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { textResult } from "../shared/deps.js";
import { resolveApiCredentials } from "./shared/pipeline-api.js";

const LIST_PIPELINE_TASKS_INPUT = {
  status: z
    .string()
    .optional()
    .describe(
      "Filter by status: pending | queued | running | pr-created | review | merged | failed | cancelled. Omit for all.",
    ),
  limit: z.number().default(20),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe(
      "Skip this many newest-first rows for paging. Response carries total so you know if more remain.",
    ),
};

export function registerListPipelineTasksTool(server: McpServer) {
  server.tool(
    "lore_list_pipeline_tasks",
    "Lists pipeline tasks newest-first as JSON, optionally filtered by status. General browse view across all tasks and statuses. Instead: lore_list_pending_tasks for unclaimed work to grab locally; lore_ready_tasks for dependency-ready spec-tasks in one repo; lore_list_task_group for one feature's group; lore_list_local_tasks for tasks running on your machine.",
    LIST_PIPELINE_TASKS_INPUT,
    async (args) => {
      try {
        return await listPipelineTasks(args);
      } catch (err) {
        return textResult(`Error listing pipeline tasks: ${errorMessage(err)}`);
      }
    },
  );
}

/** The general task listing. */
async function listPipelineTasks(args: {
  status?: string;
  limit: number;
  offset: number;
}) {
  const creds = resolveApiCredentials();

  if (!creds) {
    return textResult(
      "Pipeline requires LORE_API_URL + LORE_INGEST_TOKEN for remote access.",
    );
  }
  const params = taskListingParams(args);
  const res = await fetch(`${creds.apiUrl}/api/tasks?${params}`, {
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${creds.token}` },
  });

  return res.ok
    ? textResult(JSON.stringify(await res.json(), null, 2))
    : textResult(`Remote error: ${res.statusText}`);
}

/** `limit` is capped here rather than trusted from the caller — an agent asking for everything would otherwise pull the whole table through the MCP transport. */
function taskListingParams(args: {
  status?: string;
  limit: number;
  offset: number;
}): URLSearchParams {
  const params = new URLSearchParams({
    limit: String(Math.min(args.limit, 100)),
    offset: String(args.offset),
  });

  if (args.status) {
    params.set("status", args.status);
  }

  return params;
}
