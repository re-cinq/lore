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
