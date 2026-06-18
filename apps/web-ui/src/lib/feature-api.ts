// Server-to-server client for the mcp-server feature-planning routes. Reads of
// features go direct-DB (queryAllowMissing); lifecycle/task-spawning writes
// (create + kick planning, refine, finalize, split) go through the API so they
// enter the pipeline with the trust gate + audit. Mirrors lib/mcp-settings.ts.

export type FeatureApiResult<T = unknown> =
  | { status: 'ok'; data: T }
  | { status: 'unconfigured' }
  | { status: 'error'; message: string };

async function send<T>(
  repo: string,
  path: string,
  method: string,
  body?: unknown,
): Promise<FeatureApiResult<T>> {
  const apiUrl = process.env.LORE_API_URL;
  const token = process.env.LORE_ADMIN_TOKEN ?? process.env.LORE_INGEST_TOKEN;
  if (!apiUrl || !token) return { status: 'unconfigured' };
  try {
    const res = await fetch(`${apiUrl}/api/repos/${repo}/features${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { status: 'error', message: (data as { error?: string }).error ?? `HTTP ${res.status}` };
    return { status: 'ok', data: data as T };
  } catch (err) {
    return { status: 'error', message: (err as Error).message };
  }
}

function post<T>(repo: string, path: string, body: unknown): Promise<FeatureApiResult<T>> {
  return send<T>(repo, path, 'POST', body);
}

export function createFeature(repo: string, title: string, prompt: string) {
  return post<{ id: string; task_id: string }>(repo, '', { title, prompt });
}

export function refineFeature(repo: string, id: string, userAnswers: unknown) {
  return post<{ task_id: string; iteration: number }>(repo, `/${id}/iterations`, { user_answers: userAnswers });
}

export function finalizeFeature(repo: string, id: string) {
  return post<{ task_id: string }>(repo, `/${id}/finalize`, {});
}

export function splitFeature(repo: string, parentId: string, title: string, prompt: string) {
  return post<{ id: string }>(repo, `/${parentId}/split`, { title, prompt });
}

export function deleteFeature(repo: string, id: string) {
  return send<{ ok: true }>(repo, `/${id}`, 'DELETE');
}
