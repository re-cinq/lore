// Deterministic validation (Minions-inspired) for the local runner: run lint/typecheck after a task, retry once with a fix prompt, and hand off to a human when the retry still fails.
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import {
  detectTooling,
  runValidation,
  formatValidationOutput,
} from "@re-cinq/lore-shared";
import {
  type LocalTask,
  readConfig,
  updateTaskViaAPI,
  waitForExit,
  writeTasks,
} from "./runner-local-storage.js";
import { errFileFor, persistRunArtifacts } from "./runner-local-turns.js";

/** Headless streaming JSON, permissions skipped — the worktree is disposable and the run is unattended. */
export function claudeArgs(
  model: string | undefined,
  prompt: string,
): string[] {
  return [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--model",
    model || "claude-sonnet-4-6",
    "--",
    prompt,
  ];
}

/** Detached so the fix survives this process; its output appends to the task's own log rather than opening a second one. */
function spawnFixRun(task: LocalTask, fixOutput: string): number | undefined {
  const fixPrompt = [
    "Validation checks failed after your changes. Fix ONLY these errors.",
    "Do not re-implement the original task. Only fix the validation errors.",
    "",
    fixOutput,
  ].join("\n");
  const logFd = fs.openSync(task.logFile, "a");
  const errFd = fs.openSync(errFileFor(task.logFile), "a");
  const child = spawn("claude", claudeArgs(readConfig().model, fixPrompt), {
    cwd: task.worktreePath,
    detached: true,
    stdio: ["ignore", logFd, errFd],
    env: { ...process.env, HOME: os.homedir() },
  });

  child.unref();
  fs.closeSync(logFd);
  fs.closeSync(errFd);

  return child.pid;
}

// Spawns a Claude Code fix retry for a failed validation and re-validates; returns null when the fix child never got a pid.
/** The one retry a failed validation gets: a prompt that says fix ONLY these errors, run headless in the same worktree. */
async function attemptValidationFix(
  task: LocalTask,
  quickChecks: ReturnType<typeof detectTooling>["quickChecks"],
  changedFiles: string[],
  fixOutput: string,
): Promise<Awaited<ReturnType<typeof runValidation>> | null> {
  console.log(
    `[lore] local-runner: validation failed, attempting fix retry for ${task.taskId}`,
  );
  fs.appendFileSync(
    task.logFile,
    `\n\n--- VALIDATION FAILED ---\n${fixOutput}\n`,
  );
  const pid = spawnFixRun(task, fixOutput);

  if (pid === undefined) {
    return null;
  }
  await waitForExit(pid);

  return runValidation(task.worktreePath, quickChecks, changedFiles);
}

/** Twice-failed validation is not this runner's to resolve: mark the task, keep the transcript, and leave the worktree in place for whoever picks it up. */
export async function handOffToHuman(
  task: LocalTask,
  tasks: LocalTask[],
  idx: number,
  retry: Awaited<ReturnType<typeof runValidation>>,
): Promise<void> {
  const output = formatValidationOutput(retry);
  const failedNames = retry.steps
    .filter((s) => !s.passed)
    .map((s) => s.name)
    .join(", ");

  fs.appendFileSync(
    task.logFile,
    `\n\n--- RETRY VALIDATION FAILED ---\n${output}\n`,
  );

  if (idx >= 0) {
    tasks[idx].status = "failed";
    tasks[idx].error = `Validation failed after retry: ${failedNames}`;
  }
  await updateTaskViaAPI(task.taskId, "needs-human-help", {
    failure_reason: output.substring(0, 2000),
  });
  // Write status before the artifact round-trips — holding it across slow network calls widens the lost-update window against a concurrently finishing task.
  writeTasks(tasks);
  // needs-human-help runs still upload the transcript (a human needs it); worktree cleanup stays skipped on purpose for debugging.
  await persistRunArtifacts(task);
}

// Deterministic validation (Minions-inspired): lint/typecheck before commit with one fix retry; "failed" means the task was marked needs-human-help and its artifacts persisted.
export async function validateBeforeCommit(
  task: LocalTask,
  tasks: LocalTask[],
  idx: number,
  changedFiles: string[],
): Promise<"passed" | "failed"> {
  const tooling = detectTooling(task.worktreePath);

  if (tooling.quickChecks.length === 0) {
    return "passed";
  }
  console.log(
    `[lore] local-runner: running ${tooling.language} validation (${tooling.quickChecks.map((s) => s.name).join(", ")})`,
  );
  const validation = await runValidation(
    task.worktreePath,
    tooling.quickChecks,
    changedFiles,
  );

  if (validation.passed) {
    return "passed";
  }
  const retry = await attemptValidationFix(
    task,
    tooling.quickChecks,
    changedFiles,
    formatValidationOutput(validation),
  );

  // A fix run that never started leaves the original changes to commit — the same as having had no validation at all.
  if (!retry || retry.passed) {
    return "passed";
  }
  await handOffToHuman(task, tasks, idx, retry);

  return "failed";
}
