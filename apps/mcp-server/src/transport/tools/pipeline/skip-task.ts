import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { textResult } from "../shared/deps.js";

export function registerSkipTaskTool(server: McpServer) {
  server.tool(
    "lore_skip_task",
    "Removes one task from the local ~/.lore/pending-tasks.json notification cache so it stops appearing in the statusline. Local only — does NOT change server state (task stays 'pending'). Instead: lore_cancel_task to cancel server-side; lore_complete_task to mark a claimed spec-task done.",
    {
      task_id: z.string(),
    },
    async (args) => {
      try {
        const { skipTask } =
          await import("../../../work/pipeline/runner.local.js");

        skipTask(args.task_id);

        return textResult(`Task ${args.task_id} skipped. GKE will handle it.`);
      } catch (err) {
        return textResult(`Error skipping task: ${errorMessage(err)}`);
      }
    },
  );
}
