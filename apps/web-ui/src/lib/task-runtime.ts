// Per-task runtime records shared by the task detail page and the assembly-line
// run page: the status-transition events (pipeline.task_events) and the LLM
// cost/token rows (pipeline.llm_calls). Both are keyed by task_id.

import { query } from "./db";

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

export function fetchTaskEvents(taskId: string): Promise<TaskRuntimeEvent[]> {
  return query<TaskRuntimeEvent>(
    `SELECT * FROM pipeline.task_events WHERE task_id = $1 ORDER BY created_at`,
    [taskId],
  );
}

export function fetchLlmCalls(taskId: string): Promise<TaskRuntimeLlmCall[]> {
  return query<TaskRuntimeLlmCall>(
    `SELECT model, input_tokens, output_tokens, duration_ms, status, error, created_at
       FROM pipeline.llm_calls WHERE task_id = $1 ORDER BY created_at`,
    [taskId],
  );
}
