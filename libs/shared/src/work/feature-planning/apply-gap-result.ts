// Persisting one planning round's GapResult — shared by the features API route and the Floor's artifact-event handler so both agree exactly on ready/failed.

import {
  parseGapResult,
  sanitizeGapResult,
  decideFeatureStatus,
  isPlanningPhase,
} from "../../domain/feature-planning/gap-result.js";

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

/** Which feature and which planning round a write belongs to. */
interface RoundInput {
  featureId: string;
  iteration: number;
}

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
  const round = { featureId, iteration };
  const parsed = readGapResult(payload);

  if ("error" in parsed) {
    return markRoundFailed(features, round, parsed.error);
  }

  await recordAndAdvance(features, round, feature.status, parsed.result);

  return { outcome: "ready" };
}

/** The round's payload, or why it could not be read. An invalid payload is DATA here rather than an exception: the round still has to be marked failed and the reason recorded, and a throw would lose both. */
function readGapResult(
  payload: unknown,
): { result: ReturnType<typeof sanitizeGapResult> } | { error: string } {
  try {
    return { result: sanitizeGapResult(parseGapResult(payload)) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function markRoundFailed(
  features: GapResultFeatures,
  round: RoundInput,
  error: string,
): Promise<ApplyGapResult> {
  await features.setIterationResult(
    round.featureId,
    round.iteration,
    null,
    "failed",
  );

  return { outcome: "failed", error };
}

async function recordAndAdvance(
  features: GapResultFeatures,
  round: RoundInput,
  status: string,
  planningResult: ReturnType<typeof sanitizeGapResult>,
): Promise<void> {
  const { featureId, iteration } = round;

  await features.setIterationResult(
    featureId,
    iteration,
    planningResult,
    "ready",
  );

  await advancePlanning(features, { featureId, status }, planningResult);
}

/** Moves the feature on, but only while it is still mid-planning: a slow or duplicate delivery must not drag a finalized feature back into the wizard. */
async function advancePlanning(
  features: GapResultFeatures,
  { featureId, status }: { featureId: string; status: string },
  planningResult: ReturnType<typeof sanitizeGapResult>,
): Promise<void> {
  if (!isPlanningPhase(status as never)) {
    return;
  }

  await features.transitionStatus(
    featureId,
    decideFeatureStatus(planningResult),
    { draft_spec_md: planningResult.draft_spec_markdown },
  );
}
