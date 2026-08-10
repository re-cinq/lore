// Persisting one planning round's GapResult.
//
// Two callers reach this: the features API route (the pod POSTing its own result)
// and the Floor's handler for the subsystem's `kind:"file"` artifact event. They
// must agree exactly — a round that reads `ready` on one path and `failed` on the
// other would show the author a different feature depending on how the pod happened
// to deliver, so the parse/sanitize/transition sequence lives here once.

import {
  parseGapResult,
  sanitizeGapResult,
  decideFeatureStatus,
  isPlanningPhase,
} from "./gap-result.js";

/** The slice of `project.features` this needs — narrow so a caller can be tested
 *  against the in-memory double without a whole Project. */
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

/**
 * Record a round's result. A payload that does not validate marks the round failed
 * and reports why rather than throwing — the caller decides whether that is a 400,
 * a retry, or a log line.
 *
 * The feature only advances while it is still mid-planning: a slow or duplicate
 * delivery must not drag a finalized feature back into the wizard.
 */
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
