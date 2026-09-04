// The local runner's post-run worktree lifecycle: validate, commit, open a PR (or note "no changes"), and clean up the worktree.
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  type LocalTask,
  errorMessage,
  readTasks,
  updateTaskViaAPI,
  waitForExit,
  writeTasks,
} from "./runner-local-storage.js";
import { validateBeforeCommit } from "./runner-local-validation.js";
import { persistRunArtifacts } from "./runner-local-turns.js";

/** A run that changed nothing is finished, not failed — there is simply no PR to point at. */
export async function completeWithoutChanges(
  task: LocalTask,
  tasks: LocalTask[],
  idx: number,
): Promise<void> {
  if (idx >= 0) {
    tasks[idx].status = "completed";
  }
  console.log(
    `[lore] local-runner: ${task.taskId} produced no staged changes — skipping PR`,
  );
  await updateTaskViaAPI(task.taskId, "completed", { no_changes: true });
}

/** Commit, push, and open the PR through `gh` — the developer's own auth, never the platform's. */
function pushAndOpenPr(task: LocalTask): string {
  const branchTail = task.branch.split("/").pop() || task.taskId;
  const body = [
    "Local task executed by Lore on developer machine.",
    "",
    `Task ID: ${task.taskId}`,
  ].join("\n");

  execSync(`git commit -m "lore: local — ${branchTail}"`, {
    cwd: task.worktreePath,
    stdio: "pipe",
    timeout: 30000,
  });
  execSync(`git push origin ${task.branch}`, {
    cwd: task.worktreePath,
    stdio: "pipe",
    timeout: 60000,
  });

  return execSync(
    `gh pr create --title "lore: local — ${branchTail}" --body "${body}" --head ${task.branch}`,
    { cwd: task.worktreePath, encoding: "utf-8", timeout: 30000 },
  ).trim();
}

/** Stages the worktree, then commits, pushes, and opens a PR — or marks the task completed when nothing staged. */
async function commitAndOpenPr(
  task: LocalTask,
  tasks: LocalTask[],
  idx: number,
): Promise<void> {
  execSync("git add -A", {
    cwd: task.worktreePath,
    stdio: "pipe",
    timeout: 30000,
  });

  // Verify the index actually has changes before commit/push/PR — `git status --porcelain` can include files stripped on add (#250).
  const stagedFiles = execSync("git diff --cached --name-only", {
    cwd: task.worktreePath,
    encoding: "utf-8",
    timeout: 10000,
  }).trim();

  if (!stagedFiles) {
    await completeWithoutChanges(task, tasks, idx);

    return;
  }
  const prUrl = pushAndOpenPr(task);

  if (idx >= 0) {
    tasks[idx].status = "completed";
    tasks[idx].prUrl = prUrl;
  }
  await updateTaskViaAPI(task.taskId, "pr-created", { pr_url: prUrl });
}

/** Validates then commits/PRs the worktree's uncommitted changes. */
async function processWorktreeChanges(
  task: LocalTask,
  tasks: LocalTask[],
  idx: number,
  status: string,
): Promise<"validation-failed" | "done"> {
  const changedFiles = status
    .split("\n")
    .map((line) => line.substring(3).trim())
    .filter(Boolean);
  const validationVerdict = await validateBeforeCommit(
    task,
    tasks,
    idx,
    changedFiles,
  );

  if (validationVerdict === "failed") {
    return "validation-failed";
  }
  await commitAndOpenPr(task, tasks, idx);

  return "done";
}

/** Best effort: the worktree's `.git` file points at `.git/worktrees/<name>` in the main checkout, which is the only place `git worktree remove` can run from. A failure here costs disk, not correctness. */
export function removeWorktree(task: LocalTask): void {
  try {
    const dotGit = fs.readFileSync(
      path.join(task.worktreePath, ".git"),
      "utf-8",
    );
    const gitDir = /gitdir:\s*(.+)/.exec(dotGit);

    if (gitDir) {
      execSync(`git worktree remove "${task.worktreePath}" --force`, {
        cwd: path.resolve(gitDir[1].trim(), "..", "..", ".."),
        stdio: "pipe",
        timeout: 10000,
      });
    }
  } catch {
    console.error(
      `[lore] local-runner: could not clean up worktree for ${task.taskId}`,
    );
  }
}

export async function monitorTask(task: LocalTask): Promise<void> {
  await waitForExit(task.pid);

  const tasks = readTasks();
  const idx = tasks.findIndex((t) => t.taskId === task.taskId);

  try {
    // `git status --porcelain` in the worktree is the whole verdict on whether the run did anything.
    const status = execSync("git status --porcelain", {
      cwd: task.worktreePath,
      encoding: "utf-8",
      timeout: 10000,
    }).trim();
    const verdict = status
      ? await processWorktreeChanges(task, tasks, idx, status)
      : "no-changes";

    // A validation hand-off already wrote status and artifacts, and deliberately keeps its worktree.
    if (verdict === "validation-failed") {
      return;
    }

    if (verdict === "no-changes") {
      await completeWithoutChanges(task, tasks, idx);
    }
    removeWorktree(task);
  } catch (err: unknown) {
    const errMsg = errorMessage(err);

    if (idx >= 0) {
      tasks[idx].status = "failed";
      tasks[idx].error = errMsg;
    }
    await updateTaskViaAPI(task.taskId, "failed", { failure_reason: errMsg });
    // Don't clean up worktree on failure — keep for debugging
    console.error(`[lore] local-runner: task ${task.taskId} failed: ${errMsg}`);
  }
  // Same ordering rule as the early-return path: persist the status snapshot before the slow artifact round-trips.
  writeTasks(tasks);
  await persistRunArtifacts(task);
}
