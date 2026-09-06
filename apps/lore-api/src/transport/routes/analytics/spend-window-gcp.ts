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
  if (!row) {
    return {
      available: false,
      total_usd: 0,
      as_of: null,
      billed_through: null,
    };
  }

  return {
    available: Boolean(row.as_of),
    total_usd: row.billed_usd,
    as_of: row.as_of,
    billed_through: row.billed_through,
  };
}

/** What GCP billed for the cluster the platform runs on. */
export async function readGcpSpend(pool: Pool, win: SpendWindow) {
  const { interval } = win;

  // Same rules as the Anthropic reads (interval-filtered totals, whole-table stamps, optionalTableRows for the migration+export lag); cost is gross+credits, summed to the invoice's net.
  const gcpTotalRows = await optionalTableRows<{
    billed_usd: number;
    as_of: string | null;
    billed_through: string | null;
  }>(
    pool,
    `SELECT
       COALESCE(SUM(cost_usd + credits_usd)
         FILTER (WHERE bucket_date >= $1::date AND bucket_date <= $2::date),
         0)::float8 AS billed_usd,
       MAX(fetched_at) AS as_of,
       MAX(bucket_date)::text AS billed_through
     FROM pipeline.gcp_cost_daily`,
    [interval.from, interval.to],
  );
  const gcpByService = await optionalTableRows(
    pool,
    `SELECT service, SUM(cost_usd + credits_usd)::float8 AS cost_usd
       FROM pipeline.gcp_cost_daily
      WHERE bucket_date >= $1::date AND bucket_date <= $2::date
      GROUP BY service ORDER BY cost_usd DESC`,
    [interval.from, interval.to],
  );
  const gcpDaily = await optionalTableRows(
    pool,
    `SELECT bucket_date::text AS bucket_date,
            SUM(cost_usd + credits_usd)::float8 AS cost_usd
       FROM pipeline.gcp_cost_daily
      WHERE bucket_date >= $1::date AND bucket_date <= $2::date
      GROUP BY bucket_date ORDER BY bucket_date DESC`,
    [interval.from, interval.to],
  );

  return {
    ...toGcpTotals(gcpTotalRows[0]),
    by_service: gcpByService,
    daily: gcpDaily,
  };
}
