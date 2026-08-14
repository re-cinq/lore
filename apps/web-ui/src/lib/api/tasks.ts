import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";

// The task operations the UI needs, typed at one place. These replace direct
// `pipeline.tasks` / `pipeline.task_events` SQL in the /api/tasks/[id]/* proxy
// routes: the UI is a presentation tier, and the transitions (cancel, run-now)
// carry state rules — refusing a terminal task, recording the event — that
// belong beside the data, not in six Next route handlers.

/** The task fields the UI reads. `GET /api/task/{id}` returns the whole row
 *  plus its events; this names only what the proxies actually use. */
export interface Task {
  id: string;
  status: string;
  priority: string;
  target_repo: string;
  pr_number: number | null;
  pr_url: string | null;
}

export interface TaskRun {
  id: string;
  status: string;
  outcome: string | null;
  created_at: string;
}

export interface TaskLogs {
  logs: string | null;
  status: string;
  totalSize: number;
}

export function getTask(id: string): Promise<ApiResult<Task>> {
  return apiFetch("lore-api", `/api/task/${encodeURIComponent(id)}`);
}

/** Refuses an unknown id (404) or a terminal task (409) — the result carries
 *  both, so a proxy can answer with the same distinction it was given. */
export function cancelTask(
  id: string,
): Promise<ApiResult<{ task_id: string; status: string }>> {
  return apiFetch("lore-api", "/api/task", {
    method: "POST",
    body: { action: "cancel", task_id: id },
  });
}

/** Jump a pending task to the front of the queue. Refuses anything past
 *  `pending` (409) rather than silently leaving it where it was. */
export function runTaskNow(
  id: string,
): Promise<ApiResult<{ task_id: string; priority: string }>> {
  return apiFetch("lore-api", "/api/task", {
    method: "POST",
    body: { action: "run-now", task_id: id },
  });
}

export function getTaskRuns(
  id: string,
): Promise<ApiResult<{ runs: TaskRun[] }>> {
  return apiFetch("lore-api", `/api/tasks/${encodeURIComponent(id)}/runs`);
}

export function getTaskLogs(
  id: string,
  offset: number,
): Promise<ApiResult<TaskLogs>> {
  return apiFetch(
    "lore-api",
    `/api/task-logs?task_id=${encodeURIComponent(id)}&offset=${offset}`,
  );
}
