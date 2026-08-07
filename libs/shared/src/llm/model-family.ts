/**
 * Cross-model review policy (specs/cross-model-review). Classifies a model id
 * into the vendor family it belongs to, purely from the id string — no
 * network call, no provider SDK. An id this repo has never seen classifies as
 * `unknown` rather than being guessed into an existing family: a wrong guess
 * would let a same-family reviewer pass silently, or flag two different
 * families as matching.
 *
 * Handles the id forms actually in circulation: bare ids (`claude-sonnet-4-6`),
 * Bedrock's `[region.]vendor.model` (`us.anthropic.claude-sonnet-4-5-...-v1:0`),
 * and OpenRouter's `vendor/model` (`anthropic/claude-sonnet-4.5`). Prefix
 * matching is deliberately narrow — `claude` alone would catch `claude-code`
 * (an execution-mode/vendor name, not a model id) and bare `gpt-` would catch
 * EleutherAI's `gpt-neox-20b` / `gpt-j-6b` (servable through this repo's own
 * OllamaProvider), so both anthropic and openai match against known tier/
 * generation tokens instead of a bare vendor-word prefix.
 */

export type ModelFamily = "anthropic" | "openai" | "google" | "unknown";

const VENDOR_TOKEN_TO_FAMILY: Record<string, ModelFamily> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
};

const VENDOR_PREFIX = /^(anthropic|openai|google)[./]/;
const BEDROCK_REGION_PREFIX = /^[a-z0-9-]+\.(anthropic|openai|google)\./;

const ANTHROPIC_BARE_ID = /^claude-(opus|sonnet|haiku|fable)(-|$)/;
const OPENAI_BARE_ID = /^(gpt-[345]|chatgpt-|o[134](-|$))/;
const GOOGLE_BARE_ID = /^gemini(-|$)/;

export function modelFamily(modelId: string | undefined): ModelFamily {
  if (!modelId) {
    return "unknown";
  }

  const id = modelId.trim().toLowerCase();

  if (!id) {
    return "unknown";
  }

  const vendorPrefixed =
    id.match(VENDOR_PREFIX) ?? id.match(BEDROCK_REGION_PREFIX);

  if (vendorPrefixed) {
    return VENDOR_TOKEN_TO_FAMILY[vendorPrefixed[1]];
  }

  if (ANTHROPIC_BARE_ID.test(id)) {
    return "anthropic";
  }

  if (OPENAI_BARE_ID.test(id)) {
    return "openai";
  }

  if (GOOGLE_BARE_ID.test(id)) {
    return "google";
  }

  return "unknown";
}

/**
 * Flags an implementer/reviewer pair that resolve to the same model family —
 * the structural self-preference bias this policy targets. Returns `null` (no
 * warning) when either side is `unknown`: an unclassifiable model can't
 * support a confident same-family claim in either direction. The identical-
 * model case gets its own sharper message, since self-preference bias is
 * strongest when reviewer and implementer are the exact same model, not just
 * the same family.
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

  if (implementerModel === reviewerModel) {
    return (
      `Implementer and reviewer are the identical model (${implementerModel}); ` +
      `this is the strongest form of self-preference bias, not just same-family review.`
    );
  }

  return (
    `Implementer (${implementerModel}) and reviewer (${reviewerModel}) both ` +
    `resolve to the ${implementerFamily} model family; review lacks cross-model diversity.`
  );
}
