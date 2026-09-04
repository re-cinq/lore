// Stale Task Cleanup (Phase 3.1): a running task whose PID has died is re-queued to GKE as "pending" if older than 30 min (machine likely slept), else marked failed; the orphaned worktree is always cleaned up best effort.
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  type LocalTask,
  getApiUrl,
  getToken,
  isProcessAlive,
  readTasks,
  writeTasks,
} from "./runner-local-storage.js";

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

/** Removes an orphaned worktree by resolving its main repo from the .git file. */
function removeOrphanedWorktree(worktreePath: string): void {
  if (!fs.existsSync(worktreePath)) {
    return;
  }
  const gitFile = path.join(worktreePath, ".git");

  if (!fs.existsSync(gitFile)) {
    return;
  }
  const gitContent = fs.readFileSync(gitFile, "utf-8");
  const mainRepo = gitContent.match(/gitdir:\s*(.+)\/\.git\/worktrees/)?.[1];

  if (!mainRepo) {
    return;
  }
  execSync(`git worktree remove "${worktreePath}" --force`, {
    cwd: mainRepo,
    stdio: "pipe",
    timeout: 10000,
  });
}

/** Re-queues a stale local task for GKE (best effort). */
async function requeueStaleTask(task: LocalTask): Promise<void> {
  const apiUrl = getApiUrl();
  const token = getToken();

  if (!(apiUrl && token)) {
    return;
  }

  try {
    await fetch(`${apiUrl}/api/task`, {
      signal: AbortSignal.timeout(30_000),
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task_id: task.taskId,
        action: "requeue",
      }),
    });
    task.error = "Stale — re-queued for GKE";
    console.log(`[lore] Stale local task ${task.taskId} re-queued for GKE`);
  } catch {
    /* best effort */
  }
}

/** True once a dead task has been unattended long enough that the machine likely slept. */
function isStaleForRequeue(startedAt: string): boolean {
  return Date.now() - new Date(startedAt).getTime() > STALE_THRESHOLD_MS;
}

/** Marks a dead task failed, best-effort-cleans its orphaned worktree, and re-queues it for GKE when stale enough. */
async function recoverStaleTask(task: LocalTask): Promise<void> {
  task.status = "failed";
  task.error = "Process exited unexpectedly";

  try {
    removeOrphanedWorktree(task.worktreePath);
  } catch {
    /* best effort */
  }

  if (isStaleForRequeue(task.startedAt)) {
    await requeueStaleTask(task);
  }
}

export async function cleanupStaleTasks(): Promise<void> {
  const tasks = readTasks();
  let changed = false;

  for (const task of tasks) {
    if (task.status !== "running") {
      continue;
    }

    if (isProcessAlive(task.pid)) {
      continue;
    }

    await recoverStaleTask(task);
    changed = true;
  }

  if (changed) {
    writeTasks(tasks);
  }
}
