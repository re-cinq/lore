import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// Task operations typed at one place, replacing direct pipeline.tasks SQL in the proxy routes — transition rules (cancel, run-now) belong beside the data, not in six route handlers.
/** Task/run shapes alias the OpenAPI document lore-api generates (ADR-035); check-openapi-drift.sh guards staleness. `GET /api/task/{id}` returns more than this names. */
export type Task = components["schemas"]["TaskDetail"];

export type TaskRun = components["schemas"]["TaskRunList"]["runs"][number];

export interface TaskLogs {
  logs: string | null;
  status: string;
  totalSize: number;
}

export type CreatedTask = components["schemas"]["StationTaskCreated"];

/** Queues a task; lore-api RETURNS the new id — pages used to re-read the newest table row instead, which two concurrent submissions could misattribute to a stranger's task. */
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

/** Refuses an unknown id (404) or a terminal task (409); the proxy answers with the same distinction it was given. */
export function cancelTask(
  id: string,
): Promise<ApiResult<{ task_id: string; status: string }>> {
  return apiFetch("lore-api", "/api/task", {
    method: "POST",
    body: { action: "cancel", task_id: id },
  });
}

/** Jumps a pending task to the front of the queue; refuses anything past `pending` (409) rather than silently no-op-ing. */
export function runTaskNow(
  id: string,
): Promise<ApiResult<{ task_id: string; priority: string }>> {
  return apiFetch("lore-api", "/api/task", {
    method: "POST",
    body: { action: "run-now", task_id: id },
  });
}

/** Queues a revision from human feedback; refuses an unknown id (404) or blank feedback (409) rather than queueing an empty revision. */
export function reviseTask(
  id: string,
  feedback: string,
): Promise<ApiResult<{ task_id: string; revision_task_id: string }>> {
  return apiFetch("lore-api", "/api/task", {
    method: "POST",
    body: { action: "revise", task_id: id, feedback },
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

/** A repo's most recent tasks; empty (not an error) on a database with no `pipeline.tasks` — the panel renders without them. */
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
