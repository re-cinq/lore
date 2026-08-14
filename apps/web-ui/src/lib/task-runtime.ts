// Per-task runtime records shared by the task detail page and the assembly-line
// run page: the status-transition events (pipeline.task_events) and the LLM
// cost/token rows (pipeline.llm_calls). Both are keyed by task_id.

import { getTaskRuntime } from "./api/tasks";

export interface TaskRuntimeEvent {
  id: string;
  from_status: string | null;
  to_status: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface TaskRuntimeLlmCall {
  model: string;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  status: string | null;
  error: string | null;
  created_at: string;
}

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
