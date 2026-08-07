/**
 * Cross-model review policy (ADR-039 / specs/cross-model-review). Classifies
 * a model id into the vendor family it belongs to, purely from the id string
 * — no network call, no provider SDK. An id this repo has never seen classifies
 * as `unknown` rather than being guessed into an existing family: a wrong guess
 * would let a same-family reviewer pass silently, or flag two different
 * families as matching.
 */

export type ModelFamily = "anthropic" | "openai" | "google" | "unknown";

export function modelFamily(modelId: string | undefined): ModelFamily {
  if (!modelId) {
    return "unknown";
  }

  const id = modelId.toLowerCase();

  if (id.startsWith("claude")) {
    return "anthropic";
  }

  if (id.startsWith("gpt-")) {
    return "openai";
  }

  if (id.startsWith("gemini")) {
    return "google";
  }

  return "unknown";
}

/**
 * Flags an implementer/reviewer pair that resolve to the same model family —
 * the structural self-preference bias ADR-039 targets. Returns `null` (no
 * warning) when either side is `unknown`: an unclassifiable model can't
 * support a confident same-family claim in either direction.
 */
export function crossModelReviewWarning(
  implementerModel: string | undefined,
  reviewerModel: string | undefined,
): string | null {
  const implementerFamily = modelFamily(implementerModel);
  const reviewerFamily = modelFamily(reviewerModel);

  if (implementerFamily === "unknown" || reviewerFamily === "unknown") {
    return null;
  }

  if (implementerFamily !== reviewerFamily) {
    return null;
  }

  return (
    `Implementer (${implementerModel}) and reviewer (${reviewerModel}) both ` +
    `resolve to the ${implementerFamily} model family; review lacks cross-model diversity.`
  );
}
