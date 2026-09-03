import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/** One day/service billing bucket synced from Cloud Billing BigQuery export; (bucketDate, service) is the natural key. */

export const GcpCostDailySchema = z.object({
  bucketDate: z.string(),
  service: z.string(),
  costUsd: z.number(),
  creditsUsd: z.number(),
  fetchedAt: z.date(),
});

export type GcpCostDaily = z.infer<typeof GcpCostDailySchema>;

/** What a writer supplies; fetchedAt is stamped server-side so callers cannot set or lie about it. */
export const GcpCostDailyUpsertSchema = GcpCostDailySchema.omit({
  fetchedAt: true,
});

export type GcpCostDailyUpsert = z.infer<typeof GcpCostDailyUpsertSchema>;

export const GCP_COST_DAILY_COLUMNS = {
  bucketDate: "bucket_date",
  service: "service",
  costUsd: "cost_usd",
  creditsUsd: "credits_usd",
  fetchedAt: "fetched_at",
} as const satisfies ColumnMap<GcpCostDaily>;

export const GCP_COST_DAILY_TABLE = "pipeline.gcp_cost_daily";
