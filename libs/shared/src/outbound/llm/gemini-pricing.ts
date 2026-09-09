// Gemini per-model pricing + cost accounting, split out of gemini-provider.ts (mirrors anthropic-pricing.ts) so the provider file holds only the call path.

import type { ModelPricing } from "./model-pricing.js";

// $/token for prompts under the 200k-token tier boundary, read off https://ai.google.dev/gemini-api/docs/pricing on 2026-09-01 — reverify before relying on this table (3.7 Flash is a launch price through 2026-12-31, then doubles).
export const GEMINI_MODEL_PRICING: Record<string, ModelPricing> = {
  "gemini-2.5-pro": {
    inputPerToken: 1.25 / 1_000_000,
    outputPerToken: 10.0 / 1_000_000,
  },
  "gemini-2.5-flash": {
    inputPerToken: 0.3 / 1_000_000,
    outputPerToken: 2.5 / 1_000_000,
  },
  "gemini-2.5-flash-lite": {
    inputPerToken: 0.1 / 1_000_000,
    outputPerToken: 0.4 / 1_000_000,
  },
  "gemini-3.1-pro-preview": {
    inputPerToken: 2.0 / 1_000_000,
    outputPerToken: 12.0 / 1_000_000,
  },
  "gemini-3.7-flash": {
    inputPerToken: 0.75 / 1_000_000,
    outputPerToken: 3.75 / 1_000_000,
  },
  "gemini-3.1-flash-lite": {
    inputPerToken: 0.25 / 1_000_000,
    outputPerToken: 1.5 / 1_000_000,
  },
};

const FALLBACK_PRICING = GEMINI_MODEL_PRICING["gemini-2.5-flash"];

export function computeGeminiCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = GEMINI_MODEL_PRICING[model] ?? FALLBACK_PRICING;

  return (
    inputTokens * pricing.inputPerToken + outputTokens * pricing.outputPerToken
  );
}
