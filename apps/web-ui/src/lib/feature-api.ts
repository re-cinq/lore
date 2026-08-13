// Server-to-server client for the mcp-server feature-planning routes. Reads of
// features go direct-DB (queryAllowMissing); lifecycle/task-spawning writes
// (create + kick planning, refine, finalize, split) go through the API so they
// enter the pipeline with the trust gate + audit. Mirrors lib/mcp-settings.ts.

export type FeatureApiResult<T = unknown> =
  | { status: "ok"; data: T }
  | { status: "unconfigured" }
  | { status: "error"; message: string };

async function send<T>(
  repo: string,
  path: string,
  method: string,
  body?: unknown,
): Promise<FeatureApiResult<T>> {
  const apiUrl = process.env.LORE_API_URL;
  const token = process.env.LORE_ADMIN_TOKEN ?? process.env.LORE_INGEST_TOKEN;

  if (!apiUrl || !token) {
    return { status: "unconfigured" };
  }

  try {
    const res = await fetch(`${apiUrl}/api/repos/${repo}/features${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        status: "error",
        message: (data as { error?: string }).error ?? `HTTP ${res.status}`,
      };
    }

    return { status: "ok", data: data as T };
  } catch (err) {
    return { status: "error", message: (err as Error).message };
  }
}

function post<T>(
  repo: string,
  path: string,
  body: unknown,
): Promise<FeatureApiResult<T>> {
  return send<T>(repo, path, "POST", body);
}

/** Unwrap a call, throwing when it did not succeed. `send` reports failure in its
 *  RESULT rather than by throwing — it catches transport errors too — so a caller
 *  that ignores the return value swallows every 4xx/5xx, an unconfigured API URL
 *  and a refused connection alike. A server action that does that resolves
 *  normally: the browser is told 200, nothing was written, and the failure is
 *  indistinguishable from a no-op refresh. Next.js surfaces a THROWN action error
 *  to the client, so enforcing here is what puts the real message on screen.
 *
 *  Local rather than `enforceTrue` from @re-cinq/lore-shared, which web-ui cannot
 *  import (workspace + Docker isolation — same reason as agents-mirror.ts). */
export function enforceOk<T>(action: string, result: FeatureApiResult<T>): T {
  if (result.status === "ok") {
    return result.data;
  }

  throw new Error(
    result.status === "unconfigured"
      ? `${action} is unavailable: the web UI has no LORE_API_URL plus LORE_ADMIN_TOKEN or LORE_INGEST_TOKEN configured.`
      : `${action} failed: ${result.message}`,
  );
}

export function createFeature(repo: string, title: string, prompt: string) {
  return post<{ id: string; task_id: string }>(repo, "", { title, prompt });
}

/** Start a round. `fromIteration` REWINDS: the new round continues that round's
 *  draft and conversation instead of the latest, and records it as its parent. */
export function refineFeature(
  repo: string,
  id: string,
  userAnswers: unknown,
  fromIteration?: number,
) {
  return post<{ task_id: string; iteration: number }>(
    repo,
    `/${id}/iterations`,
    {
      user_answers: userAnswers,
      ...(fromIteration === undefined ? {} : { from_iteration: fromIteration }),
    },
  );
}

export function finalizeFeature(repo: string, id: string) {
  return post<{ task_id: string }>(repo, `/${id}/finalize`, {});
}

export function splitFeature(
  repo: string,
  parentId: string,
  title: string,
  prompt: string,
) {
  return post<{ id: string }>(repo, `/${parentId}/split`, { title, prompt });
}

export function deleteFeature(repo: string, id: string) {
  return send<{ ok: true }>(repo, `/${id}`, "DELETE");
}
