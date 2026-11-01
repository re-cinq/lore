import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { textResult } from "../shared/deps.js";
import { LOCAL_ONLY_TASK_TYPE } from "./shared/local-runner-api.js";

// Tool input schemas live as data beside their tool: a zod object is a contract, not a step in registering one.
const RUN_TASK_LOCALLY_INPUT = {
  description: z
    .string()
    .describe(
      "Free-text instruction for the agent. Must reference the current repo; cross-repo references are refused with a wrong-repo warning.",
    ),
  model: z
    .string()
    .optional()
    .describe(
      "Anthropic model id override for the spawned process (e.g. 'claude-opus-4-6').",
    ),
};

export function registerRunTaskLocallyTool(server: McpServer) {
  server.tool(
    "lore_run_task_locally",
    `Starts a brand-new ad-hoc task as a detached background Claude Code process in a local git worktree; returns immediately with task id, branch, worktree path, log file, and PID. Runs on your local machine (your Claude subscription). Instead of this: to run an EXISTING pending pipeline task by id use lore_claim_and_run_locally. The work is tracked on this machine only: code that should be tracked by the org starts from a backlog ticket with a priority label.`,
    RUN_TASK_LOCALLY_INPUT,
    async (args) => {
      try {
        return await runTaskLocally(args);
      } catch (err) {
        return textResult(`Error: ${errorMessage(err)}`);
      }
    },
  );
}

/** Starts a brand-new task here: free-form work on this machine, tracked here only. It files no pipeline task, since there is no task type to file it under; code that should be tracked starts from a backlog ticket instead. */
async function runTaskLocally(args: { description: string; model?: string }) {
  const { detectRepo } = await import("../../../work/pipeline/runner.local.js");
  const repo = detectRepo();

  if (!repo) {
    return textResult("Error: not in a git repository with a GitHub remote");
  }
  // Refuses a description that names a DIFFERENT repo than the one you are standing in — the run would push to the wrong place.
  const warning = wrongRepoWarning(args.description, repo);

  if (warning) {
    return textResult(warning);
  }

  return await spawnWorktreeRun(
    { ...args, task_type: LOCAL_ONLY_TASK_TYPE },
    repo,
    crypto.randomUUID(),
  );
}

/** Warns when `description` references an `owner/repo` other than the one the caller is in. */
function wrongRepoWarning(description: string, repo: string): string | null {
  const repoRefMatch = description.match(/\b([\w-]+\/[\w-]+)(?:#|\s)/);

  const referenced = repoRefMatch?.[1];

  if (
    !referenced ||
    referenced === repo ||
    description.toLowerCase().includes(repo)
  ) {
    return null;
  }
  const repoDir = referenced.split("/")[1];

  return `Warning: This task references ${referenced} but you're in ${repo}. Switch to the target repo first:\n  cd /path/to/${repoDir} && claude`;
}

async function spawnWorktreeRun(
  args: { description: string; task_type: string; model?: string },
  repo: string,
  taskId: string,
) {
  const { spawnLocalTask, getRepoRoot } =
    await import("../../../work/pipeline/runner.local.js");
  const task = await spawnLocalTask({
    taskId,
    prompt: args.description,
    repo,
    taskType: args.task_type,
    model: args.model,
    repoRoot: getRepoRoot() || undefined,
  });

  return textResult(
    `Task running locally in background.\n\nTask ID: ${task.taskId}\nBranch: ${task.branch}\nWorktree: ${task.worktreePath}\nLogs: ${task.logFile}\nPID: ${task.pid}\n\nYour session continues normally. Watch progress in the statusline.`,
  );
}
