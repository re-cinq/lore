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

export interface CreatedTask {
  task_id: string;
  task_type: string;
  status: string;
  priority: string;
  created_at: string;
}

/**
 * Queue a task. lore-api inserts the row and its pending `task_events` entry and
 * RETURNS the new id.
 *
 * The id matters: the create pages used to insert, then re-read the newest task
 * in the whole table to learn which one they had just made. Two concurrent
 * submissions — from any repo, by any user — and the second one wins that read,
 * so the first page attached its pending event to a stranger's task and
 * redirected the author there.
 */
export function createTask(input: {
  description: string;
  taskType?: string;
  targetRepo?: string;
  priority?: string;
  createdBy?: string;
  contextBundle?: Record<string, unknown>;
}): Promise<ApiResult<CreatedTask>> {
  return apiFetch("lore-api", "/api/task", {
    method: "POST",
    body: {
      description: input.description,
      ...(input.taskType ? { task_type: input.taskType } : {}),
      ...(input.targetRepo ? { target_repo: input.targetRepo } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.createdBy ? { created_by: input.createdBy } : {}),
      ...(input.contextBundle ? { context: input.contextBundle } : {}),
    },
  });
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

// ── dashboard reads ──────────────────────────────────────────────────

/** A repo's most recent tasks. Empty (not an error) on a database with no
 *  `pipeline.tasks` — the panel renders without them. */
export function getRepoTasks(
  repo: string,
  limit = 15,
): Promise<ApiResult<{ tasks: Record<string, unknown>[] }>> {
  const params = new URLSearchParams({ repo, limit: String(limit) });

  return apiFetch("lore-api", `/api/repo-tasks?${params}`);
}

export function getTaskStats(): Promise<
  ApiResult<{ total: number; today: number }>
> {
  return apiFetch("lore-api", "/api/task-stats");
}

/** Per-agent task counts and spend, org-wide or scoped to one repo. */
export function getAgentActivity(
  repo?: string,
): Promise<ApiResult<{ agents: Record<string, unknown>[] }>> {
  return apiFetch(
    "lore-api",
    repo
      ? `/api/agent-activity?repo=${encodeURIComponent(repo)}`
      : "/api/agent-activity",
  );
}

/** One task's transition trail and its LLM calls. */
export function getTaskRuntime(id: string): Promise<
  ApiResult<{
    events: Record<string, unknown>[];
    llm_calls: Record<string, unknown>[];
  }>
> {
  return apiFetch("lore-api", `/api/tasks/${encodeURIComponent(id)}/runtime`);
}

/** A repo's audit entries, filtered to the decision types the caller renders. */
export function getAuditLog(
  repo: string,
  eventTypes: readonly string[],
  limit = 25,
): Promise<ApiResult<{ entries: Record<string, unknown>[] }>> {
  const params = new URLSearchParams({
    repo,
    event_types: eventTypes.join(","),
    limit: String(limit),
  });

  return apiFetch("lore-api", `/api/audit-log?${params}`);
}
