// Per-task runtime records shared by the task detail page and the assembly-line
// run page: the status-transition events (pipeline.task_events) and the LLM
// cost/token rows (pipeline.llm_calls). Both are keyed by task_id.

import { getTaskRuntime } from "./api/tasks";
import type { components } from "./api/schema";

/** One task transition, as `/api/tasks/{id}/runtime` publishes it. */
export type TaskRuntimeEvent =
  components["schemas"]["TaskRuntime"]["events"][number];

/** One LLM call against the task, from the same read. */
export type TaskRuntimeLlmCall =
  components["schemas"]["TaskRuntime"]["llm_calls"][number];

export async function fetchTaskEvents(
  taskId: string,
): Promise<TaskRuntimeEvent[]> {
  const result = await getTaskRuntime(taskId);

  return (result.status === "ok"
    ? result.data.events
    : []) as unknown as TaskRuntimeEvent[];
}

export async function fetchLlmCalls(
  taskId: string,
): Promise<TaskRuntimeLlmCall[]> {
  const result = await getTaskRuntime(taskId);

  return (result.status === "ok"
    ? result.data.llm_calls
    : []) as unknown as TaskRuntimeLlmCall[];
}
