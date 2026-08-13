import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";

// The feature-planning operations, typed at one place instead of at each call
// site. Replaces src/lib/feature-api.ts, whose private `send()` hand-rolled the
// base URL, the token choice and the error mapping that now live in client.ts.

const base = (repo: string) => `/api/repos/${repo}/features`;

export function createFeature(
  repo: string,
  title: string,
  prompt: string,
): Promise<ApiResult<{ id: string; task_id: string }>> {
  return apiFetch("lore-api", base(repo), {
    method: "POST",
    body: { title, prompt },
  });
}

/** Start a round. `fromIteration` REWINDS: the new round continues that round's
 *  draft and conversation instead of the latest, and records it as its parent. */
export function refineFeature(
  repo: string,
  id: string,
  userAnswers: unknown,
  fromIteration?: number,
): Promise<
  ApiResult<{
    iteration: number;
    task_id?: string | null;
    assembly_line_id?: string;
  }>
> {
  return apiFetch("lore-api", `${base(repo)}/${id}/iterations`, {
    method: "POST",
    body: {
      user_answers: userAnswers,
      ...(fromIteration === undefined ? {} : { from_iteration: fromIteration }),
    },
  });
}

export function finalizeFeature(
  repo: string,
  id: string,
): Promise<ApiResult<{ task_id?: string; assembly_line_id?: string }>> {
  return apiFetch("lore-api", `${base(repo)}/${id}/finalize`, {
    method: "POST",
    body: {},
  });
}

export function splitFeature(
  repo: string,
  parentId: string,
  title: string,
  prompt: string,
): Promise<ApiResult<{ id: string }>> {
  return apiFetch("lore-api", `${base(repo)}/${parentId}/split`, {
    method: "POST",
    body: { title, prompt },
  });
}

export function deleteFeature(
  repo: string,
  id: string,
): Promise<ApiResult<{ ok: true }>> {
  return apiFetch("lore-api", `${base(repo)}/${id}`, { method: "DELETE" });
}
