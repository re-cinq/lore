// `lore.billed.cost_usd`: what the invoices say, as the Spend dashboard reads it. Read from the two synced daily tables (ADR-043) on each scrape, through a short cache so a 30 s scrape does not become a query storm.

import type { Pool } from "pg";
import {
  observeBilledCost,
  type BilledObservation,
} from "@re-cinq/lore-shared/otel/metrics.js";

export interface BilledCostRow {
  vendor: "anthropic" | "gcp";
  item: string;
  dayUsd: number;
  monthUsd: number;
}

const CACHE_MS = 5 * 60_000;

// Anthropic rows are per model; GCP rows are per service and reported NET of credits, as /spend does.
const BILLED_SQL = `SELECT 'anthropic' AS vendor, model AS item,
       COALESCE(SUM(cost_usd) FILTER (WHERE bucket_date = current_date), 0)::float8 AS day_usd,
       COALESCE(SUM(cost_usd) FILTER (WHERE bucket_date >= date_trunc('month', current_date)), 0)::float8 AS month_usd
  FROM pipeline.anthropic_cost_daily GROUP BY model
UNION ALL
SELECT 'gcp', service,
       COALESCE(SUM(cost_usd - credits_usd) FILTER (WHERE bucket_date = current_date), 0)::float8,
       COALESCE(SUM(cost_usd - credits_usd) FILTER (WHERE bucket_date >= date_trunc('month', current_date)), 0)::float8
  FROM pipeline.gcp_cost_daily GROUP BY service`;

/** One gauge point per vendor, item and window: two per row. */
export function billedObservations(rows: BilledCostRow[]): BilledObservation[] {
  return rows.flatMap((row) => [
    {
      value: row.dayUsd,
      attributes: { vendor: row.vendor, item: row.item, window: "day" },
    },
    {
      value: row.monthUsd,
      attributes: { vendor: row.vendor, item: row.item, window: "month" },
    },
  ]);
}

export function registerBilledCostGauge(pool: Pool): void {
  const read = cachedRows(pool);

  observeBilledCost(async () => billedObservations(await read()));
}

interface BilledSqlRow {
  vendor: "anthropic" | "gcp";
  item: string;
  day_usd: number;
  month_usd: number;
}

function cachedRows(pool: Pool): () => Promise<BilledCostRow[]> {
  let cache: { at: number; rows: BilledCostRow[] } | null = null;

  return async () => {
    if (cache && Date.now() - cache.at < CACHE_MS) {
      return cache.rows;
    }
    const { rows } = await pool.query<BilledSqlRow>(BILLED_SQL);

    cache = {
      at: Date.now(),
      rows: rows.map((row) => ({
        vendor: row.vendor,
        item: row.item,
        dayUsd: row.day_usd,
        monthUsd: row.month_usd,
      })),
    };

    return cache.rows;
  };
}
