import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { textResult } from "../shared/deps.js";

export function registerListLocalTasksTool(server: McpServer) {
  server.tool(
    "lore_list_local_tasks",
    `Lists all background tasks tracked on your local machine (running, completed, failed) with status, repo, branch, PR URL, and error. Instead of this: for server-side pipeline tasks use lore_list_pipeline_tasks; for unclaimed server tasks use lore_list_pending_tasks; for dependency-satisfied spec tasks use lore_ready_tasks; for multi-repo group rollup use lore_list_task_group.`,
    {},
    async () => {
      try {
        return await listLocalTasksText();
      } catch (err) {
        return textResult(`Error: ${errorMessage(err)}`);
      }
    },
  );
}

/** The listing is the local task file, not the pipeline — a task this machine never ran has no row here even when the org knows about it. */
async function listLocalTasksText() {
  const { listLocalTasks } =
    await import("../../../work/pipeline/runner.local.js");
  const tasks = listLocalTasks();

  if (tasks.length === 0) {
    return textResult("No local tasks.");
  }
  const lines = tasks.map(
    (t) =>
      `${t.taskId.substring(0, 8)} ${t.status} ${t.repo} ${t.branch}${t.prUrl ? " → " + t.prUrl : ""}${t.error ? " ✗ " + t.error : ""}`,
  );

  return textResult(lines.join("\n"));
}
