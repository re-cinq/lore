// Starting a local task: git worktree creation, spawning headless Claude Code detached, and the running-task read paths (list/cancel) that operate on it.
import { execSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  type LocalTask,
  LOGS_DIR,
  WORKTREES_DIR,
  detectRepo,
  ensureDirs,
  getRepoRoot,
  isProcessAlive,
  readConfig,
  readTasks,
  slugify,
  updateTaskViaAPI,
  validateRepoMatch,
  warnBestEffort,
  writeTasks,
} from "./runner-local-storage.js";
import { claudeArgs } from "./runner-local-validation.js";
import { errFileFor } from "./runner-local-turns.js";
import { monitorTask } from "./runner-local-commit.js";

// The Lore workflow preamble every locally-run task opens with — nothing is pre-fetched, so the agent assembles its own context through the MCP server as step 1.
export function withLoreWorkflowPreamble(prompt: string): string {
  return [
    "IMPORTANT: You have the Lore MCP server. Follow this workflow:",
    "1. FIRST: Call lore_assemble_context with a query describing this task. This loads conventions, ADRs, memories, facts, and graph.",
    "2. BEFORE CODING: Call lore_search_memory to check if this problem was already solved or has known gotchas. Try multiple queries.",
    "3. DURING WORK: Use lore_search_context for patterns. Use lore_query_graph for entity relationships.",
    "4. WHEN DONE: Call lore_write_episode with a summary of what you did and any non-obvious decisions.",
    "",
    "Now execute the following task:",
    "",
    prompt,
  ].join("\n");
}

/** Headless Claude Code, detached in the worktree. stdout gets the stream-json transcript (the turn-ingest source, #1295); stderr goes to a sibling file so it can never corrupt an NDJSON line mid-write. */
function spawnRun(
  worktreePath: string,
  logFile: string,
  model: string | undefined,
  prompt: string,
): number | undefined {
  const logFd = fs.openSync(logFile, "w");
  const errFd = fs.openSync(errFileFor(logFile), "w");
  const child = spawn("claude", claudeArgs(model, prompt), {
    cwd: worktreePath,
    detached: true,
    stdio: ["ignore", logFd, errFd],
    env: { ...process.env, HOME: os.homedir() },
  });

  child.unref();
  fs.closeSync(logFd);
  fs.closeSync(errFd);

  return child.pid;
}

function removeWorktreeAt(repoRoot: string, worktreePath: string): void {
  try {
    execSync(`git worktree remove "${worktreePath}" --force`, {
      cwd: repoRoot,
      stdio: "pipe",
    });
  } catch {
    /* best effort */
  }
}

// Spawns a local task in a git worktree with a background Claude Code process and returns immediately; the agent starts cold and assembles its own context via the MCP server.
/** The existence check is the idempotency guard: a second spawn for the same task must fail loudly rather than attach to a worktree another run is already using. */
function addWorktree(opts: {
  repoRoot: string;
  worktreePath: string;
  branch: string;
  taskId: string;
}): void {
  enforceTrue(
    !fs.existsSync(opts.worktreePath),
    Error,
    `Worktree already exists for task ${opts.taskId}`,
  );

  execSync(`git worktree add "${opts.worktreePath}" -b "${opts.branch}"`, {
    cwd: opts.repoRoot,
    stdio: "pipe",
    timeout: 30000,
  });
}

/** Starts the process, and takes the worktree back down if it never came up — a worktree with no run behind it is invisible work holding a branch name nobody will reuse. */
function spawnOrUnwind(
  run: { worktreePath: string; logFile: string; model: string; prompt: string },
  repoRoot: string,
): number {
  const pid = spawnRun(
    run.worktreePath,
    run.logFile,
    run.model,
    withLoreWorkflowPreamble(run.prompt),
  );

  if (pid === undefined) {
    removeWorktreeAt(repoRoot, run.worktreePath);

    throw new Error("Failed to spawn Claude Code process");
  }

  return pid;
}

/** Where one local run lives. The branch carries the task-id suffix so two runs of the same description never collide, and both the worktree and the log sit OUTSIDE the checkout — anything written inside it becomes noise in the PR (#250). */
function runPaths(run: { taskId: string; prompt: string; taskType: string }): {
  branch: string;
  worktreePath: string;
  logFile: string;
} {
  const { taskId, prompt, taskType } = run;

  return {
    branch: `lore/${taskType}/${slugify(prompt.substring(0, 60))}-${taskId.substring(0, 8)}`,
    worktreePath: path.join(WORKTREES_DIR, taskId),
    logFile: path.join(LOGS_DIR, `${taskId}.log`),
  };
}

/** Creates the worktree, starts the run, and takes the worktree back down if the process never started — a worktree with no run behind it is invisible work that blocks the branch name. */
function startRun(
  run: {
    taskId: string;
    prompt: string;
    repo: string;
    taskType: string;
    model?: string;
  },
  repoRoot: string,
): LocalTask {
  const { taskId, prompt, repo, model } = run;
  const { branch, worktreePath, logFile } = runPaths(run);

  addWorktree({ repoRoot, worktreePath, branch, taskId });

  const pid = spawnOrUnwind(
    { worktreePath, logFile, model: model || readConfig().model, prompt },
    repoRoot,
  );

  return {
    taskId,
    pid,
    branch,
    repo,
    worktreePath,
    logFile,
    startedAt: new Date().toISOString(),
    status: "running",
  };
}

/** Best-effort: the task is already recorded as cancelled, so a worktree that will not go quietly is a message rather than a failed cancellation. */
function discardWorktree(worktreePath: string, taskId: string): void {
  try {
    execSync(`git worktree remove "${worktreePath}" --force`, {
      stdio: "pipe",
      timeout: 10000,
    });
  } catch {
    console.error(
      `[lore] local-runner: could not remove worktree for ${taskId}`,
    );
  }
}

export async function spawnLocalTask(opts: {
  taskId: string;
  prompt: string;
  repo: string;
  taskType: string;
  model?: string;
  repoRoot?: string;
}): Promise<LocalTask> {
  ensureDirs();

  const { taskId, prompt, repo, taskType, model } = opts;
  const repoRoot = opts.repoRoot || getRepoRoot();

  enforceTrue(
    repoRoot,
    Error,
    "Not in a git repository — cannot create worktree",
  );

  // Refuse to run if the developer's cwd is a checkout of a different repo than the task's target_repo.
  validateRepoMatch(repo, detectRepo());

  const taskMeta = startRun(
    { taskId, prompt, repo, taskType, model },
    repoRoot,
  );
  // Task metadata goes into ~/.lore/local-tasks.json only, never inside the worktree — writing it there previously caused noise PRs (#250).
  const tasks = readTasks();

  tasks.push(taskMeta);
  writeTasks(tasks);
  monitorTask(taskMeta).catch((err) => {
    console.error(`[lore] local-runner: monitor error for ${taskId}: ${err}`);
  });

  return taskMeta;
}

/** Returns all local tasks, updating status of running tasks by checking whether their PID is still alive. */
export function listLocalTasks(): LocalTask[] {
  const tasks = readTasks();
  let changed = false;

  for (const task of tasks) {
    if (task.status === "running" && !isProcessAlive(task.pid)) {
      task.status = "failed";
      task.error = "Process exited unexpectedly";
      changed = true;
    }
  }

  if (changed) {
    writeTasks(tasks);
  }

  return tasks;
}

export function cancelLocalTask(taskId: string): {
  cancelled: boolean;
  error?: string;
} {
  const tasks = readTasks();
  const task = tasks.find((t) => t.taskId === taskId);

  if (!task) {
    return { cancelled: false, error: "Task not found" };
  }

  if (task.status !== "running") {
    return { cancelled: false, error: `Task is ${task.status}` };
  }

  // A process that is already gone is the ordinary case, not a failure to cancel.
  try {
    process.kill(task.pid, "SIGTERM");
  } catch {
    // Already dead — that's fine
  }

  task.status = "failed";
  task.error = "Cancelled by user";
  writeTasks(tasks);
  discardWorktree(task.worktreePath, taskId);

  // Update pipeline status (fire and forget)
  updateTaskViaAPI(taskId, "cancelled", {}).catch((err) =>
    warnBestEffort(`cancel status update for task ${taskId}`, err),
  );

  return { cancelled: true };
}
