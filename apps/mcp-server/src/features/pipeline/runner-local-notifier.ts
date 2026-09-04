// Task Notifier (Phase 2.2): polls for pending tasks and writes to ~/.lore/pending-tasks.json; surfaces notifications, does NOT claim anything.
import * as fs from "node:fs";
import type { PgPool } from "@re-cinq/lore-shared";
import {
  PENDING_FILE,
  type PendingTask,
  getApiUrl,
  getToken,
  warnBestEffort,
} from "./runner-local-storage.js";
import { cleanupStaleTasks } from "./runner-local-stale.js";

// Same /api/task wire shape as PendingTask, pre-normalization.
// eslint-disable-next-line lore/no-row-types-outside-models
interface PendingTaskRow {
  id: string;
  description?: string | null;
  task_type: string;
  target_repo: string;
  created_at: string;
  issue_number?: number | null;
}

function pendingTask(row: PendingTaskRow): PendingTask {
  return {
    id: row.id,
    description: (row.description || "").substring(0, 200),
    task_type: row.task_type,
    target_repo: row.target_repo,
    created_at: row.created_at,
    issue_number: row.issue_number ?? undefined,
  };
}

async function pendingFromDb(
  dbPool: PgPool,
  repos: string[],
  taskTypes: string[],
): Promise<PendingTask[] | null> {
  try {
    const { rows } = await dbPool.query<{
      id: string;
      description: string | null;
      task_type: string;
      target_repo: string;
      created_at: string;
      issue_number: number | null;
    }>(
      `SELECT id, description, task_type, target_repo, created_at, issue_number
         FROM pipeline.tasks
         WHERE status = 'pending'
           AND target_repo = ANY($1)
           AND task_type = ANY($2)
         ORDER BY created_at ASC
         LIMIT 10`,
      [repos, taskTypes],
    );

    return rows.map((r) => pendingTask(r));
  } catch {
    return null;
  }
}

async function pendingFromApi(
  repos: string[],
  taskTypes: string[],
): Promise<PendingTask[]> {
  const apiUrl = getApiUrl();
  const token = getToken();

  if (!apiUrl || !token) {
    return [];
  }

  try {
    const resp = await fetch(`${apiUrl}/api/task`, {
      signal: AbortSignal.timeout(30_000),
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "list", status: "pending" }),
    });

    if (!resp.ok) {
      return [];
    }
    const body = (await resp.json()) as { tasks?: PendingTaskRow[] };

    // The API answers with every pending task; the repo/type filter the SQL did is applied here instead.
    return (body.tasks || [])
      .filter(
        (t) => repos.includes(t.target_repo) && taskTypes.includes(t.task_type),
      )
      .map((t) => pendingTask(t));
  } catch {
    return [];
  }
}

// Fetches pending pipeline tasks matching the given repos/task types; prefers a direct DB query when a pool is available, else falls back to the Lore API.
export async function fetchPendingTasks(
  repos: string[],
  taskTypes: string[],
  dbPool?: PgPool,
): Promise<PendingTask[]> {
  if (repos.length === 0 || taskTypes.length === 0) {
    return [];
  }
  // The pool is the fast path when this process has one; anything wrong with it falls through to the API rather than failing the poll.
  const direct = dbPool ? await pendingFromDb(dbPool, repos, taskTypes) : null;

  return direct ?? (await pendingFromApi(repos, taskTypes));
}

let notifierInterval: ReturnType<typeof setInterval> | null = null;

// Starts the background task notifier: polls every 30s, writes matches to ~/.lore/pending-tasks.json (read-only, never claims), which the statusline reads to show "N new task(s)".
export function startNotifier(
  repos: string[],
  taskTypes: string[],
  dbPool?: PgPool,
): void {
  if (notifierInterval) {
    return;
  } // Already running

  let pollCount = 0;

  const poll = async () => {
    try {
      const tasks = await fetchPendingTasks(repos, taskTypes, dbPool);

      fs.writeFileSync(PENDING_FILE, JSON.stringify(tasks, null, 2));
    } catch {
      // Best effort — never crash the MCP server
    }

    // Run stale task cleanup every 5th cycle (~2.5 min at 30 s interval)
    pollCount++;

    if (pollCount % 5 === 0) {
      await cleanupStaleTasks().catch((err) =>
        warnBestEffort("stale-task cleanup sweep", err),
      );
    }
  };

  // Run immediately, then on interval
  void poll();
  notifierInterval = setInterval(() => void poll(), 30_000);
}

/** Stops the background notifier and removes the pending-tasks file. */
export function stopNotifier(): void {
  if (notifierInterval) {
    clearInterval(notifierInterval);
    notifierInterval = null;
  }

  try {
    fs.unlinkSync(PENDING_FILE);
  } catch {
    // File may not exist
  }
}

/** Returns true if the notifier polling loop is active. */
export function isNotifierRunning(): boolean {
  return notifierInterval !== null;
}

export function listPendingTasks(): PendingTask[] {
  try {
    return JSON.parse(fs.readFileSync(PENDING_FILE, "utf-8"));
  } catch {
    return [];
  }
}

// Removes a task from local pending-tasks.json so the notification disappears; it remains pending server-side, and GKE picks it up after its 30s grace period unless claimed first.
export function skipTask(taskId: string): void {
  const tasks = listPendingTasks();
  const filtered = tasks.filter((t) => t.id !== taskId);

  fs.writeFileSync(PENDING_FILE, JSON.stringify(filtered, null, 2));
}
