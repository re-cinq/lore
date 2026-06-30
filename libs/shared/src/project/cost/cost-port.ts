/**
 * One row in `pipeline.anthropic_cost_daily` — a single day/model billing
 * bucket synced from the Anthropic organization cost + usage reports. The
 * `(bucketDate, model)` pair is the natural key (the table's ON CONFLICT
 * target); `fetchedAt` is stamped server-side with `now()` on every write.
 */
export interface AnthropicCostDailyRow {
  bucketDate: string;
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/**
 * The Anthropic daily-cost upsert surface. The cost-sync job writes one row
 * per day/model bucket through here instead of a bespoke DB writer, so the
 * kernel never imports a pg pool directly. The write is an upsert keyed on
 * `(bucketDate, model)`: a re-synced bucket replaces the stored totals.
 */
export interface CostPort {
  upsertDaily(row: AnthropicCostDailyRow): Promise<void>;
}
