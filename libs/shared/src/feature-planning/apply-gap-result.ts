// Persisting one planning round's GapResult — shared by the features API route and the Floor's artifact-event handler so both agree exactly on ready/failed.

import {
  parseGapResult,
  sanitizeGapResult,
  decideFeatureStatus,
  isPlanningPhase,
} from "./gap-result.js";

/** The slice of `project.features` this needs — narrow so a caller can be tested against the in-memory double without a whole Project. */
export interface GapResultFeatures {
  get(id: string): Promise<{ status: string } | null>;
  setIterationResult(
    id: string,
    iteration: number,
    gap: ReturnType<typeof sanitizeGapResult> | null,
    status: "ready" | "failed",
  ): Promise<void>;
  transitionStatus(
    id: string,
    status: ReturnType<typeof decideFeatureStatus>,
    patch?: { draft_spec_md?: string },
  ): Promise<unknown>;
}

export type ApplyGapResult =
  { outcome: "ready" } | { outcome: "failed"; error: string };

/** Records a round's result; an invalid payload marks it failed and reports why rather than throwing. Advances the feature only while still mid-planning, so a slow/duplicate delivery can't drag a finalized feature back into the wizard. */
export async function applyGapResult(
  features: GapResultFeatures,
  featureId: string,
  iteration: number,
  payload: unknown,
): Promise<ApplyGapResult> {
  const feature = await features.get(featureId);

  if (!feature) {
    return { outcome: "failed", error: "feature not found" };
  }

  let planningResult: ReturnType<typeof sanitizeGapResult>;

  try {
    planningResult = sanitizeGapResult(parseGapResult(payload));
  } catch (err) {
    await features.setIterationResult(featureId, iteration, null, "failed");

    return {
      outcome: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  await features.setIterationResult(
    featureId,
    iteration,
    planningResult,
    "ready",
  );

  if (isPlanningPhase(feature.status as never)) {
    await features.transitionStatus(
      featureId,
      decideFeatureStatus(planningResult),
      { draft_spec_md: planningResult.draft_spec_markdown },
    );
  }

  return { outcome: "ready" };
}
