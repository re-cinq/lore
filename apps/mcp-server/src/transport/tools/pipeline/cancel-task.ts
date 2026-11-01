import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { proxyToApi } from "../shared/deps.js";
import { proxiedText } from "./shared/pipeline-api.js";

export function registerCancelTaskTool(server: McpServer) {
  server.tool(
    "lore_cancel_task",
    "Cancels a server-side pipeline task, flipping it to 'cancelled' and best-effort stopping any running GKE agent. Instead: lore_cancel_local_task to stop a task running in a local worktree; lore_retry_task to re-run a failed task rather than stop a live one. Rejected for tasks already in merged/failed/cancelled state.",
    {
      task_id: z.string(),
    },
    ({ task_id }) =>
      proxiedText(
        () => proxyToApi("/api/task", { action: "cancel", task_id }),
        {
          op: "cancelling a task",
          toolName: "lore_cancel_task",
          render: (body) => JSON.stringify(body),
        },
      ),
  );
}
