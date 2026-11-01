import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { textResult } from "../shared/deps.js";
import { cachedLogRead } from "./shared/cached-log-read.js";

const GET_TASK_LOGS_INPUT = {
  task_id: z.string(),
  offset: z
    .number()
    .default(0)
    .describe(
      "UTF-16 code-unit offset (not bytes) into the flattened transcript; pass previous next_offset to poll incrementally.",
    ),
  cursor: z
    .string()
    .optional()
    .describe(
      "Opaque resume cursor from the previous response; pass it back only together with that response's next_offset as offset. Omit it when reading from any other offset.",
    ),
};

export function registerGetTaskLogsTool(server: McpServer) {
  server.tool(
    "lore_get_task_logs",
    "Fetches one pipeline task's execution transcript (by UUID), returning {logs, next_offset, complete, cursor?}. Tasks with recorded agent turns return NDJSON — one {source, event} stream-json envelope per line from the turn store; tasks with no recorded turns fall back to the raw captured output. Responses may be capped: pass next_offset back as offset (and cursor back verbatim, when present) and poll until complete is true. Instead: lore_get_job_logs (job_name + run_id) for scheduled CronJob run logs.",
    GET_TASK_LOGS_INPUT,
    async (args) => {
      try {
        return await getTaskLogs(args);
      } catch (err) {
        return textResult(`Error getting task logs: ${errorMessage(err)}`);
      }
    },
  );
}

/** The API resolves the task's repo from task_id — the local adapter holds no DB to look it up in. An absent cursor is left out of the cache key rather than keyed as undefined, so the first page and a re-read of it share one entry. */
function getTaskLogs(read: {
  task_id: string;
  offset: number;
  cursor?: string;
}) {
  const { task_id, offset, cursor } = read;

  return cachedLogRead({
    tool: "lore_get_task_logs",
    missing: "Task logs require LORE_API_URL.",
    path: (apiUrl) =>
      `${apiUrl}/api/task-logs?${buildTaskLogsParams(task_id, offset, cursor)}`,
    args:
      cursor === undefined ? { task_id, offset } : { task_id, offset, cursor },
  });
}

function buildTaskLogsParams(
  taskId: string,
  offset: number,
  cursor: string | undefined,
): URLSearchParams {
  const params = new URLSearchParams({
    task_id: taskId,
    offset: String(offset),
  });

  if (cursor !== undefined) {
    params.set("cursor", cursor);
  }

  return params;
}
