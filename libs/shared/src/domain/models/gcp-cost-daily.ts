import { z } from "zod";
import type { ColumnMap } from "../../lib/row.js";

/** One day/service billing bucket of a cloud provider's invoice: the Cloud Billing BigQuery export for GCP, Cost Management for Azure. The table kept its GCP name when the provider column arrived (migration 0130); (provider, bucketDate, service) is the natural key. */

export const CLOUD_COST_PROVIDERS = ["gcp", "azure"] as const;

export type CloudCostProvider = (typeof CLOUD_COST_PROVIDERS)[number];

export const GcpCostDailySchema = z.object({
  provider: z.enum(CLOUD_COST_PROVIDERS),
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
}).partial({ provider: true });

export type GcpCostDailyUpsert = z.infer<typeof GcpCostDailyUpsertSchema>;

export const GCP_COST_DAILY_COLUMNS = {
  provider: "provider",
  bucketDate: "bucket_date",
  service: "service",
  costUsd: "cost_usd",
  creditsUsd: "credits_usd",
  fetchedAt: "fetched_at",
} as const satisfies ColumnMap<GcpCostDaily>;

export const GCP_COST_DAILY_TABLE = "pipeline.gcp_cost_daily";
