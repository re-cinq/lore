import type { PendingTask } from "../../work/pipeline/runner.local.js";

// Talks to the Lore API on behalf of the local runner tools — task registration, lookup, and best-effort claim.

interface ApiCredentials {
  apiUrl: string;
  token: string;
}

/** Registers the task via the API, returning the server-issued id, or null when offline. */
export async function createPipelineTaskViaApi(
  description: string,
  taskType: string,
  repo: string,
): Promise<string | null> {
  const creds = resolveApiCredentials();

  if (!creds) {
    return null;
  }

  return postTaskCreate(creds, {
    description,
    task_type: taskType,
    target_repo: repo,
    created_by: "local-runner",
  });
}

function resolveApiCredentials(): ApiCredentials | null {
  const apiUrl = process.env.LORE_API_URL || "";
  const token = process.env.LORE_INGEST_TOKEN || "";

  return apiUrl && token ? { apiUrl, token } : null;
}

async function postTaskCreate(
  creds: ApiCredentials,
  body: Record<string, unknown>,
): Promise<string | null> {
  try {
    const resp = await postTask(creds, body);
    const created = (await resp.json()) as { task_id?: string };

    return created.task_id ?? null;
  } catch {
    return null;
  }
}

// /api/task is both the create and the claim endpoint — the action is carried in the body, so one poster serves both callers.
function postTask(
  creds: ApiCredentials,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${creds.apiUrl}/api/task`, {
    signal: AbortSignal.timeout(30_000),
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

// Lore's own /api/task/{id} wire response (mirrors pipeline.tasks columns).
// eslint-disable-next-line re-lint/no-row-types-outside-models
interface FetchedTask {
  status?: string;
  id: string;
  description: string;
  task_type: string;
  target_repo: string;
  issue_number?: number;
  created_at: string;
}

/** Fetches one task from the API; undefined when unreachable or not pending. */
export async function fetchPendingTaskFromApi(
  taskId: string,
): Promise<PendingTask | undefined> {
  const creds = resolveApiCredentials();

  if (!creds) {
    return undefined;
  }

  try {
    const resp = await getTask(creds, taskId);

    if (!resp.ok) {
      return undefined;
    }
    const fetchedTask = (await resp.json()) as FetchedTask;

    return toPendingTask(fetchedTask);
  } catch {
    return undefined;
  }
}

function getTask(creds: ApiCredentials, taskId: string): Promise<Response> {
  return fetch(`${creds.apiUrl}/api/task/${taskId}`, {
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${creds.token}` },
  });
}

function toPendingTask(fetchedTask: FetchedTask): PendingTask | undefined {
  if (fetchedTask.status !== "pending") {
    return undefined;
  }

  return {
    id: fetchedTask.id,
    description: fetchedTask.description,
    task_type: fetchedTask.task_type,
    target_repo: fetchedTask.target_repo,
    issue_number: fetchedTask.issue_number,
    created_at: fetchedTask.created_at,
  };
}

/** Local pending cache first, then the API fallback (supports cross-repo tasks). */
export async function resolvePendingTask(
  taskId: string,
  pending: PendingTask[],
): Promise<PendingTask | undefined> {
  const local = pending.find((t) => t.id === taskId || t.id.startsWith(taskId));

  return local ?? (await fetchPendingTaskFromApi(taskId));
}

export async function claimTaskBestEffort(taskId: string): Promise<void> {
  const creds = resolveApiCredentials();

  if (!creds) {
    return;
  }

  try {
    await postTask(creds, {
      task_id: taskId,
      action: "claim",
      claimed_by: "local-runner",
    });
  } catch {
    /* best effort */
  }
}
