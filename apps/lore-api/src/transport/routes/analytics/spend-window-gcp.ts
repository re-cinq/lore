import type { Pool } from "pg";
import { optionalTableRows, type SpendWindow } from "./spend-window-db.js";

// Same as_of rule as the Anthropic half: distinguishes "synced and spent nothing" from "never synced".
function toGcpTotals(
  row:
    | {
        billed_usd: number;
        as_of: string | null;
        billed_through: string | null;
      }
    | undefined,
): {
  available: boolean;
  total_usd: number;
  as_of: string | null;
  billed_through: string | null;
} {
  return row ? gcpTotalsOf(row) : NO_GCP_TOTALS;
}

const NO_GCP_TOTALS = {
  available: false,
  total_usd: 0,
  as_of: null,
  billed_through: null,
};

function gcpTotalsOf(row: {
  billed_usd: number;
  as_of: string | null;
  billed_through: string | null;
}) {
  return {
    available: Boolean(row.as_of),
    total_usd: row.billed_usd,
    as_of: row.as_of,
    billed_through: row.billed_through,
  };
}

/** One GCP breakdown — by service, or by day. Both sum gross plus credits, which is what nets to the invoice; reporting gross alone would show a bill nobody pays. `optionalTableRows` absorbs a missing table, because the billing export lands after the migration that reads it. */
async function gcpBreakdown(
  pool: Pool,
  interval: { from: string; to: string },
  by: "service" | "bucket_date",
) {
  const column =
    by === "service" ? "service" : "bucket_date::text AS bucket_date";
  const order = by === "service" ? "cost_usd DESC" : "bucket_date DESC";

  return optionalTableRows(
    pool,
    `SELECT ${column}, SUM(cost_usd + credits_usd)::float8 AS cost_usd
       FROM pipeline.gcp_cost_daily
      WHERE bucket_date >= $1::date AND bucket_date <= $2::date
      GROUP BY ${by} ORDER BY ${order}`,
    [interval.from, interval.to],
  );
}

// Same rules as the Anthropic reads (interval-filtered totals, whole-table stamps, optionalTableRows for the migration+export lag); cost is gross+credits, summed to the invoice's net.
const GCP_TOTALS_SQL = `SELECT
       COALESCE(SUM(cost_usd + credits_usd)
         FILTER (WHERE bucket_date >= $1::date AND bucket_date <= $2::date),
         0)::float8 AS billed_usd,
       MAX(fetched_at) AS as_of,
       MAX(bucket_date)::text AS billed_through
     FROM pipeline.gcp_cost_daily`;

/** What GCP billed for the cluster the platform runs on. */
export async function readGcpSpend(pool: Pool, win: SpendWindow) {
  const { interval } = win;
  const gcpTotalRows = await optionalTableRows<{
    billed_usd: number;
    as_of: string | null;
    billed_through: string | null;
  }>(pool, GCP_TOTALS_SQL, [interval.from, interval.to]);

  return {
    ...toGcpTotals(gcpTotalRows[0]),
    by_service: await gcpBreakdown(pool, interval, "service"),
    daily: await gcpBreakdown(pool, interval, "bucket_date"),
  };
}
