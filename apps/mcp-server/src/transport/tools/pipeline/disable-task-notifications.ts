import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { textResult } from "../shared/deps.js";

export function registerDisableTaskNotificationsTool(server: McpServer) {
  server.tool(
    "lore_disable_task_notifications",
    "Stops the local pending-task notifier and removes the ~/.lore/pending-tasks.json cache. Undoes lore_enable_task_notifications. Idempotent.",
    {},
    async () => {
      const { stopNotifier } =
        await import("../../../work/pipeline/runner.local.js");

      stopNotifier();

      return textResult("Task notifications stopped.");
    },
  );
}
