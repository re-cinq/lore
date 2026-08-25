import type { AnthropicCostDailyUpsert } from "../../models/anthropic-cost-daily.js";

/**
 * What a writer supplies for one `pipeline.anthropic_cost_daily` bucket. The
 * shape is the model's upsert projection — `fetchedAt` is stamped server-side
 * with `now()`, so it is not a caller's to set.
 */
export type AnthropicCostDailyRow = AnthropicCostDailyUpsert;

/**
 * The Anthropic daily-cost upsert surface. The cost-sync job writes one row
 * per day/model bucket through here instead of a bespoke DB writer, so the
 * kernel never imports a pg pool directly. The write is an upsert keyed on
 * `(bucketDate, model)`: a re-synced bucket replaces the stored totals.
 */
export interface CostPort {
  upsertDaily(row: AnthropicCostDailyRow): Promise<void>;
}
