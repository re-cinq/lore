import "server-only";
import type { RunIdCarrier } from "./run-id";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type {
  FeatureRow,
  FeatureIterationRow,
  FeatureWithIterations,
} from "@/lib/feature-types";

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
  ApiResult<
    {
      iteration: number;
      task_id?: string | null;
    } & RunIdCarrier
  >
> {
  return apiFetch("lore-api", `${base(repo)}/${id}/iterations`, {
    method: "POST",
    body: {
      user_answers: userAnswers,
      ...(fromIteration === undefined ? {} : { from_iteration: fromIteration }),
    },
  });
}

/// todo: this must also send the latest form answers to the server so they will be added to the context
export function createSpecFile(
  repo: string,
  id: string,
): Promise<ApiResult<{ task_id?: string } & RunIdCarrier>> {
  /// todo: rename this endpoint to something like "createSpecFile" because it does not finalize the feature, it just moves the context in the assembly run to the next station and starts it. The user still needs to review the PR for the spec and provide feedback on the assembly run.
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

// ── reads ────────────────────────────────────────────────────────────
//
// The feature pages used to SELECT `lore.features` / `lore.feature_iterations`
// themselves, duplicating reads lore-api already served — including one pair
// (`FeatureDetailPage` and `feature-poll`) running the same two queries
// side by side.

export function listFeatures(
  repo: string,
): Promise<ApiResult<{ features: FeatureRow[] }>> {
  return apiFetch("lore-api", base(repo));
}

/** A feature and every round it has been through. 404 for an id this repo does
 *  not hold — which is NOT the same as a feature with no rounds. */
export function getFeature(
  repo: string,
  id: string,
): Promise<ApiResult<FeatureWithIterations>> {
  return apiFetch("lore-api", `${base(repo)}/${id}`);
}

/** The wizard's 4s poll: the row, its latest round, the most recent round that
 *  produced a result, and the line the run graph hangs on. Deliberately not the
 *  full feature — that carries every round's mockups and repo stylesheet. */
export function getFeatureStatus(
  repo: string,
  id: string,
): Promise<
  ApiResult<
    {
      feature: FeatureRow;
      latest_iteration: FeatureIterationRow | null;
      last_ready_iteration: FeatureIterationRow | null;
    } & RunIdCarrier
  >
> {
  return apiFetch("lore-api", `${base(repo)}/${id}/status`);
}

/** The spec-tasks a merged spec decomposed into (ADR-029). */
export function getFeatureDecomposition(
  repo: string,
  id: string,
): Promise<
  ApiResult<{
    tasks: {
      description: string;
      status: string;
      context_bundle: Record<string, unknown> | null;
    }[];
  }>
> {
  return apiFetch("lore-api", `${base(repo)}/${id}/decomposition`);
}
