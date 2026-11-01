import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { textResult } from "../shared/deps.js";
import type { PendingTask } from "../../../work/pipeline/runner.local.js";
import {
  resolvePendingTask,
  claimTaskBestEffort,
} from "./shared/local-runner-api.js";

// Tool input schemas live as data beside their tool: a zod object is a contract, not a step in registering one.
const CLAIM_AND_RUN_LOCALLY_INPUT = {
  task_id: z
    .string()
    .describe(
      "Id or unique id-prefix of the pending task (from lore_list_pending_tasks); must be in 'pending' status.",
    ),
  model: z
    .string()
    .optional()
    .describe(
      "Anthropic model id override for non-ingest tasks (e.g. 'claude-opus-4-6').",
    ),
};

export function registerClaimAndRunLocallyTool(server: McpServer) {
  server.tool(
    "lore_claim_and_run_locally",
    `Claims an EXISTING pending pipeline task by id and runs it on your local machine (your Claude subscription), then removes it from the pending list. ingest-* types run in-process with no worktree; all others spawn a background Claude Code worktree task and return task id, branch, log file, and PID. Instead of this: to start a BRAND-NEW task from a description use lore_run_task_locally.`,
    CLAIM_AND_RUN_LOCALLY_INPUT,
    async (args) => {
      try {
        return await claimAndRunLocally(args);
      } catch (err) {
        return textResult(`Error: ${errorMessage(err)}`);
      }
    },
  );
}

/** Takes an EXISTING pending task. The claim is best-effort: the local cache may hold a task this machine cannot reach the API to claim, and the run is still worth starting. */
async function claimAndRunLocally(args: { task_id: string; model?: string }) {
  const { listPendingTasks } =
    await import("../../../work/pipeline/runner.local.js");
  const task = await resolvePendingTask(args.task_id, listPendingTasks());

  if (!task) {
    return textResult(
      `Task ${args.task_id} not found or not in pending status. Run lore_list_pending_tasks first.`,
    );
  }
  await claimTaskBestEffort(task.id);

  return await runClaimedTask(task, args.model);
}

/** The skip is not best-effort the way the claim is: leaving the task on the pending list after the worktree has started is how two machines end up running the same task. */
async function runClaimedTask(task: PendingTask, model?: string) {
  const { spawnLocalTask, getRepoRoot, skipTask } =
    await import("../../../work/pipeline/runner.local.js");
  const localTask = await spawnLocalTask({
    taskId: task.id,
    prompt: task.description,
    repo: task.target_repo,
    taskType: task.task_type,
    model,
    repoRoot: getRepoRoot() || undefined,
  });

  skipTask(task.id);

  return textResult(
    `Claimed and running locally.\n\nTask: ${task.id}\nBranch: ${localTask.branch}\nLogs: ${localTask.logFile}\nPID: ${localTask.pid}`,
  );
}
