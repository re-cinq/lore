// Deterministic validation (Minions-inspired) for the local runner: run lint/typecheck after a task, retry once with a fix prompt, and hand off to a human when the retry still fails.
import * as fs from "node:fs";
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
import { persistRunArtifacts } from "./runner-local-turns.js";
import { spawnClaude } from "./runner-local-claude.js";

/** Detached so the fix survives this process; its output appends to the task's own log rather than opening a second one. */
function spawnFixRun(task: LocalTask, fixOutput: string): number | undefined {
  const fixPrompt = [
    "Validation checks failed after your changes. Fix ONLY these errors.",
    "Do not re-implement the original task. Only fix the validation errors.",
    "",
    fixOutput,
  ].join("\n");

  return spawnClaude({
    cwd: task.worktreePath,
    logFile: task.logFile,
    logMode: "a",
    model: readConfig().model,
    prompt: fixPrompt,
  });
}

// Spawns a Claude Code fix retry for a failed validation and re-validates; returns null when the fix child never got a pid.
/** The one retry a failed validation gets: a prompt that says fix ONLY these errors, run headless in the same worktree. */
async function fixAndRevalidate(
  task: LocalTask,
  tooling: ReturnType<typeof detectTooling>,
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

  return runValidation(task.worktreePath, tooling.quickChecks, changedFiles);
}

function failedStepNames(
  retry: Awaited<ReturnType<typeof runValidation>>,
): string {
  const failed = retry.steps.filter((step) => !step.passed);

  return failed.map((step) => step.name).join(", ");
}

/** The task log is the only artifact a human inherits, so the retry output is appended before any status write can fail. */
function recordRetryFailure(task: LocalTask, output: string): void {
  fs.appendFileSync(
    task.logFile,
    `\n\n--- RETRY VALIDATION FAILED ---\n${output}\n`,
  );
}

/** Twice-failed validation is not this runner's to resolve: mark the task, keep the transcript, and leave the worktree in place for whoever picks it up. */
export async function handOffToHuman(
  task: LocalTask,
  tasks: LocalTask[],
  idx: number,
  retry: Awaited<ReturnType<typeof runValidation>>,
): Promise<void> {
  const output = formatValidationOutput(retry);
  const failedNames = failedStepNames(retry);

  recordRetryFailure(task, output);

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

/** Null means there was nothing to run: a repo with no detectable tooling is not a failing repo. The pass is scoped to the files this run changed, so pre-existing lint debt cannot fail every task that touches the repo. */
async function validateOrSkip(
  task: LocalTask,
  tooling: ReturnType<typeof detectTooling>,
  changedFiles: string[],
): Promise<Awaited<ReturnType<typeof runValidation>> | null> {
  if (tooling.quickChecks.length === 0) {
    return null;
  }
  const { language, quickChecks } = tooling;
  const names = quickChecks.map((step) => step.name).join(", ");

  console.log(`[lore] local-runner: running ${language} validation (${names})`);

  return runValidation(task.worktreePath, tooling.quickChecks, changedFiles);
}

// Deterministic validation (Minions-inspired): lint/typecheck before commit with one fix retry; "failed" means the task was marked needs-human-help and its artifacts persisted.
export async function validateBeforeCommit(
  task: LocalTask,
  tasks: LocalTask[],
  idx: number,
  changedFiles: string[],
): Promise<"passed" | "failed"> {
  const tooling = detectTooling(task.worktreePath);
  const validation = await validateOrSkip(task, tooling, changedFiles);

  if (!validation || validation.passed) {
    return "passed";
  }
  const failure = formatValidationOutput(validation);
  const retry = await fixAndRevalidate(task, tooling, changedFiles, failure);

  // A fix run that never started leaves the original changes to commit — the same as having had no validation at all.
  if (!retry || retry.passed) {
    return "passed";
  }
  await handOffToHuman(task, tasks, idx, retry);

  return "failed";
}
