import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/**
 * `pipeline.gcp_cost_daily` — one day/service billing bucket, synced from the
 * Cloud Billing BigQuery export (the only machine-readable channel Google
 * publishes actual spend through).
 *
 * DDL: migration `0060_gcp_cost_daily.sql`. `(bucketDate, service)` is the
 * natural key and the upsert's ON CONFLICT target; `service` is the export's
 * `service.description` ("Kubernetes Engine", "Compute Engine", …). `costUsd`
 * is the gross list cost and `creditsUsd` the (negative) credit sum for the
 * same bucket — stored separately because the invoice line a person reconciles
 * against shows both, and net-only storage cannot be taken apart again.
 */

export const GcpCostDailySchema = z.object({
  bucketDate: z.string(),
  service: z.string(),
  costUsd: z.number(),
  creditsUsd: z.number(),
  fetchedAt: z.date(),
});

export type GcpCostDaily = z.infer<typeof GcpCostDailySchema>;

/**
 * What a writer supplies. `fetchedAt` is stamped server-side with `now()` on
 * every write, so a caller neither sets it nor can lie about it.
 */
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
