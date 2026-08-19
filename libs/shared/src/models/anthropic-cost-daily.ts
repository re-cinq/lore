import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/**
 * `pipeline.anthropic_cost_daily` — one day/model billing bucket, synced from
 * Anthropic's Admin Cost + Usage reports.
 *
 * DDL: migration `0009_anthropic_cost_daily.sql`. `(bucketDate, model)` is the
 * natural key and the upsert's ON CONFLICT target; a row with `model: ""` holds
 * non-token cost (web search, code execution). `costUsd` is DOLLARS — the Admin
 * API returns cents-as-string and the parser divides by 100.
 */

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

/**
 * What a writer supplies. `fetchedAt` is stamped server-side with `now()` on
 * every write, so a caller neither sets it nor can lie about it.
 */
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
