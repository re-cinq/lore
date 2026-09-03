import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/** One day/model billing bucket synced from Anthropic Admin Cost + Usage; (bucketDate, model) is the natural key. */

export const AnthropicCostDailySchema = z.object({
  bucketDate: z.string(),
  model: z.string(),
  costUsd: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheCreationTokens: z.number(),
  cacheReadTokens: z.number(),
  fetchedAt: z.date(),
});

export type AnthropicCostDaily = z.infer<typeof AnthropicCostDailySchema>;

/** What a writer supplies; fetchedAt is stamped server-side so callers cannot set or lie about it. */
export const AnthropicCostDailyUpsertSchema = AnthropicCostDailySchema.omit({
  fetchedAt: true,
});

export type AnthropicCostDailyUpsert = z.infer<
  typeof AnthropicCostDailyUpsertSchema
>;

export const ANTHROPIC_COST_DAILY_COLUMNS = {
  bucketDate: "bucket_date",
  model: "model",
  costUsd: "cost_usd",
  inputTokens: "input_tokens",
  outputTokens: "output_tokens",
  cacheCreationTokens: "cache_creation_tokens",
  cacheReadTokens: "cache_read_tokens",
  fetchedAt: "fetched_at",
} as const satisfies ColumnMap<AnthropicCostDaily>;

export const ANTHROPIC_COST_DAILY_TABLE = "pipeline.anthropic_cost_daily";
