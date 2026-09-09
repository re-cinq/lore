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

// The PR's body, naming the task so the run is traceable back from GitHub.
function prBody(task: LocalTask): string {
  return [
    "Local task executed by Lore on developer machine.",
    "",
    `Task ID: ${task.taskId}`,
  ].join("\n");
}

// Commit then push. The push gets the longer timeout — it is the step that talks to the network, and a slow remote is not a failure.
function commitAndPush(task: LocalTask, branchTail: string): void {
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
}

/** Commit, push, and open the PR through `gh` — the developer's own auth, never the platform's. */
function pushAndOpenPr(task: LocalTask): string {
  const { branch } = task;
  const branchTail = branch.split("/").pop() || task.taskId;
  const body = prBody(task);

  commitAndPush(task, branchTail);

  return execSync(
    `gh pr create --title "lore: local — ${branchTail}" --body "${body}" --head ${task.branch}`,
    { cwd: task.worktreePath, encoding: "utf-8", timeout: 30000 },
  ).trim();
}

// Stages everything and reports whether the INDEX actually has changes. Checked against `git diff --cached` rather than `git status --porcelain`, which can list files that `add` then strips (#250) — staging is not the same as having something to commit.
function stageAll(task: LocalTask): boolean {
  execSync("git add -A", {
    cwd: task.worktreePath,
    stdio: "pipe",
    timeout: 30000,
  });

  return Boolean(
    execSync("git diff --cached --name-only", {
      cwd: task.worktreePath,
      encoding: "utf-8",
      timeout: 10000,
    }).trim(),
  );
}

/** Stages the worktree, then commits, pushes, and opens a PR — or marks the task completed when nothing staged. */
async function commitAndOpenPr(
  task: LocalTask,
  tasks: LocalTask[],
  idx: number,
): Promise<void> {
  if (!stageAll(task)) {
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

// The paths out of `git status --porcelain`. The first three characters are the two status columns and a space, so the path starts at index 3 — a rename's "old -> new" form is left as written, which is what the caller passes to the validators anyway.
function changedPaths(status: string): string[] {
  return status
    .split("\n")
    .map((line) => line.substring(3).trim())
    .filter(Boolean);
}

/** Validates then commits/PRs the worktree's uncommitted changes. */
async function processWorktreeChanges(
  task: LocalTask,
  tasks: LocalTask[],
  idx: number,
  status: string,
): Promise<"validation-failed" | "done"> {
  const changedFiles = changedPaths(status);
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

// What the run left in the worktree. This is the whole verdict on whether it did anything: an empty status means the agent finished without changing a file.
function worktreeStatus(task: LocalTask): string {
  return execSync("git status --porcelain", {
    cwd: task.worktreePath,
    encoding: "utf-8",
    timeout: 10000,
  }).trim();
}

/** What the finished run left behind. `git status --porcelain` in the worktree is the whole verdict on whether it did anything; the worktree goes away in both settled cases. */
async function settleRun(
  task: LocalTask,
  tasks: LocalTask[],
  idx: number,
): Promise<string> {
  const status = worktreeStatus(task);
  const verdict = status
    ? await processWorktreeChanges(task, tasks, idx, status)
    : "no-changes";

  if (verdict === "validation-failed") {
    return verdict;
  }

  if (verdict === "no-changes") {
    await completeWithoutChanges(task, tasks, idx);
  }
  removeWorktree(task);

  return verdict;
}

/** The worktree is deliberately KEPT on failure: it holds the run's state, and it is the only thing a developer can open to see what went wrong. */
async function recordRunFailure(
  task: LocalTask,
  tasks: LocalTask[],
  idx: number,
  errMsg: string,
): Promise<void> {
  if (idx >= 0) {
    tasks[idx].status = "failed";
    tasks[idx].error = errMsg;
  }
  await updateTaskViaAPI(task.taskId, "failed", { failure_reason: errMsg });
  console.error(`[lore] local-runner: task ${task.taskId} failed: ${errMsg}`);
}

export async function monitorTask(task: LocalTask): Promise<void> {
  await waitForExit(task.pid);

  const tasks = readTasks();
  const idx = tasks.findIndex((t) => t.taskId === task.taskId);

  try {
    if ((await settleRun(task, tasks, idx)) === "validation-failed") {
      // The hand-off already wrote status and artifacts, and deliberately keeps its worktree.
      return;
    }
  } catch (err: unknown) {
    await recordRunFailure(task, tasks, idx, errorMessage(err));
  }
  // Same ordering rule as the early-return path: persist the status snapshot before the slow artifact round-trips.
  writeTasks(tasks);
  await persistRunArtifacts(task);
}
