// Cross-model review policy helpers (specs/cross-model-review): LLMs favor
// their own generations, so the reviewer of an agent-authored change should
// run on a different model family than its author. The policy itself lives in
// `lore.agent_definitions` rows; these pure helpers are what the settings
// surface uses to warn when a per-repo override collapses author and reviewer
// back onto one family.

export type ModelFamily = "anthropic" | "openai" | "google" | "unknown";

const FAMILY_PREFIXES: ReadonlyArray<[RegExp, ModelFamily]> = [
  [/^claude/i, "anthropic"],
  // `o\d` anchors only the first two characters, so it covers the whole
  // reasoning-model series (o1, o3, o4-mini, a future o10-…) without
  // claiming every id that merely starts with "o".
  [/^(gpt|o\d)/i, "openai"],
  [/^gemini/i, "google"],
];

export function modelFamily(model: string): ModelFamily {
  const match = FAMILY_PREFIXES.find(([re]) => re.test(model));

  return match ? match[1] : "unknown";
}

/**
 * The same-family warning for the settings surface: a message when the
 * implementer and reviewer models resolve to one family (sharpest when they
 * are the identical model — the reviewer would grade its own homework), null
 * when they are cross-family or either family is unknown (never guess).
 */
export function crossModelReviewWarning(
  implementationModel: string,
  reviewModel: string,
): string | null {
  const implementationFamily = modelFamily(implementationModel);
  const reviewFamily = modelFamily(reviewModel);

  if (implementationFamily === "unknown" || reviewFamily === "unknown") {
    return null;
  }

  if (implementationModel === reviewModel) {
    return `Implementation and review both resolve to the same model (${implementationModel}) — the reviewer grades its own homework. Pin the review agent to a different model family.`;
  }

  if (implementationFamily === reviewFamily) {
    return `Implementation (${implementationModel}) and review (${reviewModel}) resolve to the same model family (${implementationFamily}) — self-preference bias applies. Prefer a cross-family review model.`;
  }

  return null;
}
