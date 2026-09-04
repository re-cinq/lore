import type { Pool } from "pg";
import { NON_ANTHROPIC_LIKE_PATTERNS } from "@re-cinq/lore-shared/llm/model-vendor.js";
import { optionalTableRows } from "./spend-window-db.js";

interface BilledSlice {
  billedUsd: number;
  billedThrough: string | null;
}

// A missing billed row (unmigrated table) owes nothing and anchors nothing — the caller's computed-side query still needs a billedThrough of null, not a thrown error.
function billedSlice(
  row: { billed_usd: number; billed_through: string | null } | undefined,
): BilledSlice {
  if (!row) {
    return { billedUsd: 0, billedThrough: null };
  }

  return { billedUsd: row.billed_usd, billedThrough: row.billed_through };
}

// remaining = ledger - (billed + computed); the two halves meet at billed_through (billed through-and-including it, computed strictly after) — an off-by-one double-counts or drops a day.
async function remainingBudget(
  pool: Pool,
  anchoredAt: string,
  ledgerTotalUsd: number,
) {
  // Whole days (Anthropic's report is day-bucketed, unsplittable); MAX(bucket_date) over the WHOLE table (not the interval), since the anchor can predate it.
  const [billedRow] = await optionalTableRows<{
    billed_usd: number;
    billed_through: string | null;
  }>(
    pool,
    `SELECT
       COALESCE(SUM(cost_usd)
         FILTER (WHERE bucket_date >= (($1::timestamptz) AT TIME ZONE 'UTC')::date),
         0)::float8 AS billed_usd,
       MAX(bucket_date)::text AS billed_through
     FROM pipeline.anthropic_cost_daily`,
    [anchoredAt],
  );
  const { billedUsd, billedThrough } = billedSlice(billedRow);

  return remainingBudgetFrom(pool, anchoredAt, ledgerTotalUsd, {
    billedUsd,
    billedThrough,
  });
}

// Split off `remainingBudget` so the computed-side read (imports NON_ANTHROPIC_LIKE_PATTERNS) stays a single, unnested call.
async function remainingBudgetFrom(
  pool: Pool,
  anchoredAt: string,
  ledgerTotalUsd: number,
  { billedUsd, billedThrough }: BilledSlice,
) {
  // Computed spend strictly after billed_through, only Anthropic-charged calls (Gemini calls since 2026-09-02 excluded).
  const [computed] = await optionalTableRows<{ cost_usd: number }>(
    pool,
    `SELECT COALESCE(SUM(lc.cost_usd), 0)::float8 AS cost_usd
       FROM pipeline.llm_calls lc
       LEFT JOIN pipeline.station_runs sr
         ON sr.station_run_id = lc.station_run_id
      WHERE lc.created_at >= $1::timestamptz
        AND ($2::date IS NULL OR lc.created_at::date > $2::date)
        AND sr.cluster_agent_id IS NULL
        AND lc.model NOT LIKE ALL($3::text[])`,
    [anchoredAt, billedThrough, [...NON_ANTHROPIC_LIKE_PATTERNS]],
  );
  const spentSinceUsd = billedUsd + (computed ? computed.cost_usd : 0);

  return {
    ledger_total_usd: ledgerTotalUsd,
    spent_since_usd: spentSinceUsd,
    remaining_usd: ledgerTotalUsd - spentSinceUsd,
    anchored_at: anchoredAt,
  };
}

/** The recorded balance, which is NOT interval-scoped: a ledger is a running total, and clipping it to a window would report a balance the account never had. */
export async function readBudget(pool: Pool) {
  // Read last, so no other read's statement ordering shifts; an empty ledger yields anchored_at null (no anchor, no arithmetic, no budget).
  const [ledger] = await optionalTableRows<{
    ledger_total_usd: number;
    anchored_at: string | null;
  }>(
    pool,
    // Anchor = the OPENING entry (not MIN over everything — a backdated top-up must not drag the window back), falling back to earliest non-correction; corrections are excluded from the anchor but not the total; rendered as an explicit ISO-8601 UTC string since a pg Date doesn't survive the wire+RSC boundary.
    `SELECT COALESCE(SUM(amount_usd), 0)::float8 AS ledger_total_usd,
       to_char(
         COALESCE(
           MIN(effective_at) FILTER (WHERE kind = 'opening'),
           MIN(effective_at) FILTER (WHERE kind <> 'correction')
         ) AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"'
       ) AS anchored_at
     FROM pipeline.credit_ledger`,
  );
  const budget = ledger?.anchored_at
    ? await remainingBudget(pool, ledger.anchored_at, ledger.ledger_total_usd)
    : null;

  return budget;
}
