import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { textResult } from "../shared/deps.js";

export function registerCancelLocalTaskTool(server: McpServer) {
  server.tool(
    "lore_cancel_local_task",
    `Stops a locally-running background worktree task: kills the process, removes the worktree, and marks it cancelled. Instead of this: to cancel a server-side GKE pipeline task use lore_cancel_task.`,
    {
      task_id: z.string(),
    },
    async (args) => {
      try {
        return await cancelLocalTaskText(args.task_id);
      } catch (err) {
        return textResult(`Error: ${errorMessage(err)}`);
      }
    },
  );
}

/** Cancellation is reported, not thrown: an already-gone process and a missing worktree are both ordinary outcomes here. */
async function cancelLocalTaskText(taskId: string) {
  const { cancelLocalTask } =
    await import("../../../work/pipeline/runner.local.js");
  const result = cancelLocalTask(taskId);

  return textResult(
    result.cancelled
      ? `Task ${taskId} cancelled. Worktree cleaned up.`
      : `Could not cancel: ${result.error}`,
  );
}
