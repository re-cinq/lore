/** Per-model $/token pricing and usage/cost accounting for the Anthropic provider. */

import type Anthropic from "@anthropic-ai/sdk";
import type { ModelPricing } from "./model-pricing.js";

// $/token from published $/1M rates; cache 1.25x write/0.1x read multipliers; reverify vs shared/live-sources.md when adding tier.
const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-fable-5": {
    inputPerToken: 10.0 / 1_000_000,
    outputPerToken: 50.0 / 1_000_000,
  },
  "claude-opus-5": {
    inputPerToken: 5.0 / 1_000_000,
    outputPerToken: 25.0 / 1_000_000,
  },
  "claude-opus-4-8": {
    inputPerToken: 5.0 / 1_000_000,
    outputPerToken: 25.0 / 1_000_000,
  },
  "claude-sonnet-5": {
    inputPerToken: 2.0 / 1_000_000,
    outputPerToken: 10.0 / 1_000_000,
  },
  "claude-sonnet-4-6": {
    inputPerToken: 3.0 / 1_000_000,
    outputPerToken: 15.0 / 1_000_000,
  },
  "claude-haiku-4-5-20251001": {
    inputPerToken: 0.8 / 1_000_000,
    outputPerToken: 4.0 / 1_000_000,
  },
};

// Unrecognized model (new tier or dated snapshot) uses cheapest tier for logging (least-wrong default cost).
const FALLBACK_PRICING = MODEL_PRICING["claude-haiku-4-5-20251001"];

function pricingFor(model: string): ModelPricing {
  return MODEL_PRICING[model] ?? FALLBACK_PRICING;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export function extractUsage(response: Anthropic.Message): TokenUsage {
  return {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
  };
}

export function computeCost(
  model: string,
  {
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
  }: TokenUsage,
): number {
  const pricing = pricingFor(model);

  return (
    inputTokens * pricing.inputPerToken +
    outputTokens * pricing.outputPerToken +
    cacheCreationTokens * pricing.inputPerToken * 1.25 +
    cacheReadTokens * pricing.inputPerToken * 0.1
  );
}
