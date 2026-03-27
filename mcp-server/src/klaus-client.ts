/**
 * Klaus HTTP MCP client.
 *
 * Communicates with the Klaus endpoint defined by LORE_KLAUS_ENDPOINT.
 * Uses native fetch (Node 18+). All functions return result objects
 * rather than throwing on errors.
 */

// ── Interfaces ───────────────────────────────────────────────────────

export interface SubmitTaskRequest {
  task: string;
  context_bundle: string;
  priority: string;
}

export interface SubmitTaskResponse {
  task_id: string;
  status: 'submitted';
}

export interface TaskStatus {
  task_id: string;
  status: 'submitted' | 'running' | 'completed' | 'failed';
  elapsed?: number;
  failure_reason?: string;
}

export interface TaskResult {
  task_id: string;
  status: 'completed';
  output: string;
}

export interface TaskListItem {
  task_id: string;
  status: string;
  created_at?: string;
}

export interface KlausError {
  error: true;
  message: string;
}

type KlausResult<T> = T | KlausError;

// ── Helpers ──────────────────────────────────────────────────────────

function getEndpoint(): string {
  const endpoint = process.env.LORE_KLAUS_ENDPOINT;
  if (!endpoint) {
    throw new Error('LORE_KLAUS_ENDPOINT environment variable is not set');
  }
  return endpoint.replace(/\/+$/, '');
}

function isKlausError(value: unknown): value is KlausError {
  return typeof value === 'object' && value !== null && (value as any).error === true;
}

async function klausFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<KlausResult<T>> {
  let endpoint: string;
  try {
    endpoint = getEndpoint();
  } catch (e: any) {
    return { error: true, message: e.message };
  }

  try {
    const res = await fetch(`${endpoint}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        error: true,
        message: `Klaus responded with ${res.status}: ${body}`,
      };
    }

    return (await res.json()) as T;
  } catch (e: any) {
    return {
      error: true,
      message: `Klaus connection error: ${e.message}`,
    };
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Submit a new task to Klaus.
 */
export async function submitTask(
  task: string,
  contextBundle: string,
  priority: string,
): Promise<KlausResult<SubmitTaskResponse>> {
  return klausFetch<SubmitTaskResponse>('/mcp', {
    method: 'POST',
    body: JSON.stringify({
      task,
      context_bundle: contextBundle,
      priority,
    } satisfies SubmitTaskRequest),
  });
}

/**
 * Get the status of a submitted task.
 */
export async function getTaskStatus(
  taskId: string,
): Promise<KlausResult<TaskStatus>> {
  return klausFetch<TaskStatus>(`/mcp/tasks/${encodeURIComponent(taskId)}/status`);
}

/**
 * Get the result of a completed task.
 */
export async function getTaskResult(
  taskId: string,
): Promise<KlausResult<TaskResult>> {
  return klausFetch<TaskResult>(`/mcp/tasks/${encodeURIComponent(taskId)}/result`);
}

/**
 * List all tasks.
 */
export async function listTasks(): Promise<KlausResult<TaskListItem[]>> {
  return klausFetch<TaskListItem[]>('/mcp/tasks');
}

export { isKlausError };
