import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { textResult } from "./deps.js";
import type {
  LocalRunnerConfig,
  PendingTask,
} from "../../work/pipeline/runner.local.js";
import {
  createPipelineTaskViaApi,
  resolvePendingTask,
  claimTaskBestEffort,
} from "./local-runner-api.js";

export {
  createPipelineTaskViaApi,
  fetchPendingTaskFromApi,
} from "./local-runner-api.js";

// Tool input schemas live as data beside their tool: a zod object is a contract, not a step in registering one.
const RUN_TASK_LOCALLY_INPUT = {
  description: z
    .string()
    .describe(
      "Free-text instruction for the agent. Must reference the current repo; cross-repo references are refused with a wrong-repo warning.",
    ),
  task_type: z
    .enum(["implementation", "general", "runbook", "gap-fill"])
    .default("implementation")
    .describe(
      "Kind of work: 'implementation' (code), 'general' (open-ended), 'runbook' (incident runbook), 'gap-fill' (missing docs).",
    ),
  model: z
    .string()
    .optional()
    .describe(
      "Anthropic model id override for the spawned process (e.g. 'claude-opus-4-6').",
    ),
};

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

const CONFIGURE_LOCAL_RUNNER_INPUT = {
  max_concurrent: z
    .number()
    .optional()
    .describe("Max simultaneous local background tasks (positive integer)."),
  repos: z
    .array(z.string())
    .optional()
    .describe(
      "owner/repo slugs the local notifier watches (e.g. ['re-cinq/lore']). Replaces the whole list.",
    ),
  task_types: z
    .array(z.string())
    .optional()
    .describe(
      "Task-type names eligible to run locally. Replaces the whole list.",
    ),
  model: z
    .string()
    .optional()
    .describe("Default model id for local tasks (e.g. 'claude-sonnet-4-6')."),
};

export function registerLocalRunnerTools(server: McpServer) {
  registerRunTaskLocallyTool(server);
  registerListLocalTasksTool(server);
  registerCancelLocalTaskTool(server);
  registerClaimAndRunLocallyTool(server);
  registerConfigureLocalRunnerTool(server);
}

/** Warns when `description` references an `owner/repo` other than the one the caller is in. */
function wrongRepoWarning(description: string, repo: string): string | null {
  const repoRefMatch = description.match(/\b([\w-]+\/[\w-]+)(?:#|\s)/);

  if (
    !repoRefMatch ||
    repoRefMatch[1] === repo ||
    description.toLowerCase().includes(repo)
  ) {
    return null;
  }

  return `Warning: This task references ${repoRefMatch[1]} but you're in ${repo}. Switch to the target repo first:\n  cd /path/to/${repoRefMatch[1].split("/")[1]} && claude`;
}

/** The id is already resolved by the caller because the pipeline row must exist before the process does — a run with no id is invisible to the org. */
async function spawnWorktreeRun(
  args: { description: string; task_type: string; model?: string },
  repo: string,
  taskId: string,
) {
  const { spawnLocalTask, getRepoRoot } =
    await import("../../work/pipeline/runner.local.js");
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

/** Starts a brand-new task here. The pipeline row is created first so the task has an id the org can see; offline it falls back to a generated uuid rather than refusing to run, because the worktree run is the point and the row is bookkeeping. */
async function runTaskLocally(args: {
  description: string;
  task_type: string;
  model?: string;
}) {
  const { detectRepo } = await import("../../work/pipeline/runner.local.js");
  const repo = detectRepo();

  if (!repo) {
    return textResult("Error: not in a git repository with a GitHub remote");
  }
  // Refuses a description that names a DIFFERENT repo than the one you are standing in — the run would push to the wrong place.
  const warning = wrongRepoWarning(args.description, repo);

  if (warning) {
    return textResult(warning);
  }
  const taskId =
    (await createPipelineTaskViaApi(args.description, args.task_type, repo)) ??
    crypto.randomUUID();

  return await spawnWorktreeRun(args, repo, taskId);
}

/** The skip is not best-effort the way the claim is: leaving the task on the pending list after the worktree has started is how two machines end up running the same task. */
async function runClaimedTask(task: PendingTask, model?: string) {
  const { spawnLocalTask, getRepoRoot, skipTask } =
    await import("../../work/pipeline/runner.local.js");
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

/** Takes an EXISTING pending task. The claim is best-effort: the local cache may hold a task this machine cannot reach the API to claim, and the run is still worth starting. */
async function claimAndRunLocally(args: { task_id: string; model?: string }) {
  const { listPendingTasks } =
    await import("../../work/pipeline/runner.local.js");
  const task = await resolvePendingTask(args.task_id, listPendingTasks());

  if (!task) {
    return textResult(
      `Task ${args.task_id} not found or not in pending status. Run lore_list_pending_tasks first.`,
    );
  }
  await claimTaskBestEffort(task.id);

  return await runClaimedTask(task, args.model);
}

function registerRunTaskLocallyTool(server: McpServer) {
  server.tool(
    "lore_run_task_locally",
    `Starts a brand-new ad-hoc task as a detached background Claude Code process in a local git worktree; returns immediately with task id, branch, worktree path, log file, and PID. Runs on your local machine (your Claude subscription). Instead of this: to run an EXISTING pending pipeline task by id use lore_claim_and_run_locally; to register a task for the GKE agent use lore_create_pipeline_task.`,
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

/** The listing is the local task file, not the pipeline — a task this machine never ran has no row here even when the org knows about it. */
async function listLocalTasksText() {
  const { listLocalTasks } =
    await import("../../work/pipeline/runner.local.js");
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

function registerListLocalTasksTool(server: McpServer) {
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

/** Cancellation is reported, not thrown: an already-gone process and a missing worktree are both ordinary outcomes here. */
async function cancelLocalTaskText(taskId: string) {
  const { cancelLocalTask } =
    await import("../../work/pipeline/runner.local.js");
  const result = cancelLocalTask(taskId);

  return textResult(
    result.cancelled
      ? `Task ${taskId} cancelled. Worktree cleaned up.`
      : `Could not cancel: ${result.error}`,
  );
}

function registerCancelLocalTaskTool(server: McpServer) {
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

function registerClaimAndRunLocallyTool(server: McpServer) {
  server.tool(
    "lore_claim_and_run_locally",
    `Claims an EXISTING pending pipeline task by id and runs it on your local machine (your Claude subscription), then removes it from the pending list. ingest-* types run in-process with no worktree; all others spawn a background Claude Code worktree task and return task id, branch, log file, and PID. Instead of this: to start a BRAND-NEW task from a description use lore_run_task_locally; to register a task for the GKE agent use lore_create_pipeline_task.`,
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

interface ConfigureLocalRunnerArgs {
  max_concurrent?: number;
  repos?: string[];
  task_types?: string[];
  model?: string;
}

function hasConfigureArgs(args: ConfigureLocalRunnerArgs): boolean {
  return Boolean(
    args.max_concurrent || args.repos || args.task_types || args.model,
  );
}

function applyConfigureUpdate(
  config: LocalRunnerConfig,
  args: ConfigureLocalRunnerArgs,
): LocalRunnerConfig {
  const next = { ...config };

  if (args.max_concurrent !== undefined) {
    next.max_concurrent = args.max_concurrent;
  }

  if (args.repos) {
    next.repos = args.repos;
  }

  if (args.task_types) {
    next.task_types = args.task_types;
  }

  if (args.model) {
    next.model = args.model;
  }

  return next;
}

/** No arguments means read, not "clear everything" — the tool doubles as the config viewer. */
async function configureLocalRunner(args: ConfigureLocalRunnerArgs) {
  const { readConfig, writeConfig } =
    await import("../../work/pipeline/runner.local.js");
  const config = readConfig();

  if (!hasConfigureArgs(args)) {
    return textResult(JSON.stringify(config, null, 2));
  }
  const updated = applyConfigureUpdate(config, args);

  writeConfig(updated);

  return textResult(`Config updated:\n${JSON.stringify(updated, null, 2)}`);
}

function registerConfigureLocalRunnerTool(server: McpServer) {
  server.tool(
    "lore_configure_local_runner",
    `Views or updates the local runner config on your machine; returns current config as JSON when called with no arguments, or writes provided fields and returns 'Config updated:' + JSON. Controls which repos/task-types the local notifier watches and local concurrency/model limits. To run work locally use lore_run_task_locally (new task) or lore_claim_and_run_locally (existing task).`,
    CONFIGURE_LOCAL_RUNNER_INPUT,
    async (args) => {
      try {
        return await configureLocalRunner(args);
      } catch (err) {
        return textResult(`Error: ${errorMessage(err)}`);
      }
    },
  );
}
