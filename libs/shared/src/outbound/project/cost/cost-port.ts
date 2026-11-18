import type { AnthropicCostDailyUpsert } from "../../../domain/models/anthropic-cost-daily.js";
import type { GcpCostDailyUpsert } from "../../../domain/models/gcp-cost-daily.js";

/** What a writer supplies for one pipeline.anthropic_cost_daily bucket; fetchedAt is stamped server-side with now(), not a caller's to set. */
export type AnthropicCostDailyRow = AnthropicCostDailyUpsert;

/** Anthropic daily-cost upsert surface — the cost-sync job writes one row per day/model bucket here so the kernel never imports a pg pool directly. Upsert keyed on (bucketDate, model): a re-synced bucket replaces stored totals. */
export interface CostPort {
  upsertDaily(row: AnthropicCostDailyRow): Promise<void>;
}

/** What a writer supplies for one pipeline.gcp_cost_daily bucket, under the same fetchedAt-is-server-side rule as the Anthropic row. */
export type GcpCostDailyRow = GcpCostDailyUpsert;

/** Cloud daily-cost upsert surface — the write path of the gcp-cost-sync and azure-cost-sync stations, keyed on (provider, bucketDate, service), a row with no provider being GCP's; a re-synced bucket replaces stored totals, letting a late restatement in Google's export self-heal. */
export interface GcpCostPort {
  upsertGcpDaily(row: GcpCostDailyRow): Promise<void>;
}
