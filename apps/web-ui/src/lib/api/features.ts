import "server-only";
import type { RunIdCarrier } from "./run-id";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type {
  FeatureRow,
  FeatureIterationRow,
  FeatureWithIterations,
} from "@/lib/feature-types";

// Feature-planning operations typed at one place; replaces feature-api.ts, whose private send() hand-rolled what now lives in client.ts.
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

/** Start a round; `fromIteration` REWINDS — the new round continues that round's draft/conversation instead of the latest, recording it as parent. */
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

/** Accept the plan — `userAnswers` is whatever the author typed before pressing accept, folded into the plan the tail nodes turn into a spec. */
export function createSpecFile(
  repo: string,
  id: string,
  userAnswers: unknown,
): Promise<ApiResult<{ task_id?: string } & RunIdCarrier>> {
  return apiFetch("lore-api", `${base(repo)}/${id}/create-spec-file`, {
    method: "POST",
    body: { user_answers: userAnswers },
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

// ── reads ── feature pages used to SELECT lore.features/feature_iterations directly, duplicating reads lore-api already served.
export function listFeatures(
  repo: string,
): Promise<ApiResult<{ features: FeatureRow[] }>> {
  return apiFetch("lore-api", base(repo));
}

/** A feature and every round; 404 for an id this repo does not hold — NOT the same as a feature with no rounds. */
export function getFeature(
  repo: string,
  id: string,
): Promise<ApiResult<FeatureWithIterations>> {
  return apiFetch("lore-api", `${base(repo)}/${id}`);
}

/** The wizard's 4s poll — deliberately not the full feature, which carries every round's mockups and repo stylesheet. */
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
