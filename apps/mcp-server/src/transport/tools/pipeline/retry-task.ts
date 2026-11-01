import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { proxyToApi } from "../shared/deps.js";
import { proxiedText } from "./shared/pipeline-api.js";

export function registerRetryTaskTool(server: McpServer) {
  server.tool(
    "lore_retry_task",
    "Re-runs a failed or escalated task by cloning it into a new pipeline task linked via retry_of. Only tasks in 'failed' or 'needs-human-help' state are retryable. Instead: lore_cancel_task to stop an unwanted live task rather than re-run it.",
    {
      task_id: z.string(),
    },
    ({ task_id }) =>
      proxiedText(() => proxyToApi("/api/task", { action: "retry", task_id }), {
        op: "retrying a task",
        toolName: "lore_retry_task",
        render: (body) => JSON.stringify(body),
      }),
  );
}
