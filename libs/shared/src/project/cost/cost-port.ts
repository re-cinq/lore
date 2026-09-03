import type { AnthropicCostDailyUpsert } from "../../models/anthropic-cost-daily.js";
import type { GcpCostDailyUpsert } from "../../models/gcp-cost-daily.js";

/** What a writer supplies for one pipeline.anthropic_cost_daily bucket; fetchedAt is stamped server-side with now(), not a caller's to set. */
export type AnthropicCostDailyRow = AnthropicCostDailyUpsert;

/** Anthropic daily-cost upsert surface — the cost-sync job writes one row per day/model bucket here so the kernel never imports a pg pool directly. Upsert keyed on (bucketDate, model): a re-synced bucket replaces stored totals. */
export interface CostPort {
  upsertDaily(row: AnthropicCostDailyRow): Promise<void>;
}

/** What a writer supplies for one pipeline.gcp_cost_daily bucket, under the same fetchedAt-is-server-side rule as the Anthropic row. */
export type GcpCostDailyRow = GcpCostDailyUpsert;

/** GCP daily-cost upsert surface — the gcp-cost-sync station's write path, keyed on (bucketDate, service); a re-synced bucket replaces stored totals, letting a late restatement in Google's export self-heal. */
export interface GcpCostPort {
  upsertGcpDaily(row: GcpCostDailyRow): Promise<void>;
}
