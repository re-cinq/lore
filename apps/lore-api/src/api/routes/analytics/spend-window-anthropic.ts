import type { Pool } from "pg";
import { NON_ANTHROPIC_LIKE_PATTERNS } from "@re-cinq/lore-shared/llm/model-vendor.js";
import { optionalTableRows, type SpendWindow } from "./spend-window-db.js";

interface BilledAnthropicTotals {
  totalUsd: number;
  inputTokens: number;
  outputTokens: number;
  asOf: string | null;
  billedThrough: string | null;
  available: boolean;
}

// `as_of`, not a row count, distinguishes "synced and owes nothing" from "never synced" — the view hides billed sections for the latter rather than showing a confident zero.
function toBilledAnthropicTotals(
  row:
    | {
        billed_usd: number;
        input_tokens: number;
        output_tokens: number;
        as_of: string | null;
        billed_through: string | null;
      }
    | undefined,
): BilledAnthropicTotals {
  if (!row) {
    return {
      totalUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      asOf: null,
      billedThrough: null,
      available: false,
    };
  }

  return {
    totalUsd: row.billed_usd,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    asOf: row.as_of,
    billedThrough: row.billed_through,
    available: Boolean(row.as_of),
  };
}

async function readBilledAnthropicTotals(
  pool: Pool,
  interval: SpendWindow["interval"],
): Promise<BilledAnthropicTotals> {
  const billedTotalRows = await optionalTableRows<{
    billed_usd: number;
    input_tokens: number;
    output_tokens: number;
    as_of: string | null;
    billed_through: string | null;
  }>(
    pool,
    `SELECT
       COALESCE(SUM(cost_usd)
         FILTER (WHERE bucket_date >= $1::date AND bucket_date <= $2::date),
         0)::float8 AS billed_usd,
       COALESCE(SUM(input_tokens)
         FILTER (WHERE bucket_date >= $1::date AND bucket_date <= $2::date),
         0)::float8 AS input_tokens,
       COALESCE(SUM(output_tokens)
         FILTER (WHERE bucket_date >= $1::date AND bucket_date <= $2::date),
         0)::float8 AS output_tokens,
       MAX(fetched_at) AS as_of,
       MAX(bucket_date)::text AS billed_through
     FROM pipeline.anthropic_cost_daily`,
    [interval.from, interval.to],
  );

  return toBilledAnthropicTotals(billedTotalRows[0]);
}

interface UnbilledAnthropicSpend {
  costUsd: number;
  days: number;
}

// Every interval day Anthropic has not billed yet; `billedThrough` is passed as a param (not joined in) so an absent anthropic_cost_daily can't take this sync-independent half down too.
async function readUnbilledAnthropicSpend(
  pool: Pool,
  win: SpendWindow,
  billedThrough: string | null,
): Promise<UnbilledAnthropicSpend> {
  const { rows } = await pool.query<{
    cost_usd: number;
    days: number;
  }>(
    `SELECT COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd,
            COUNT(DISTINCT created_at::date)::int AS days
       FROM pipeline.llm_calls
      WHERE created_at >= $1 AND created_at < $2
        AND ($3::date IS NULL OR created_at::date > $3::date)
        AND model NOT LIKE ALL($4::text[])`,
    [win.fromTs, win.toTs, billedThrough, [...NON_ANTHROPIC_LIKE_PATTERNS]],
  );
  const row = rows[0];

  return { costUsd: row?.cost_usd ?? 0, days: row?.days ?? 0 };
}

async function readBilledAnthropicByModel(
  pool: Pool,
  interval: SpendWindow["interval"],
) {
  return optionalTableRows(
    pool,
    `SELECT model, SUM(cost_usd)::float8 AS cost_usd,
            SUM(input_tokens)::float8 AS input_tokens,
            SUM(output_tokens)::float8 AS output_tokens
       FROM pipeline.anthropic_cost_daily
      WHERE bucket_date >= $1::date AND bucket_date <= $2::date
      GROUP BY model ORDER BY cost_usd DESC`,
    [interval.from, interval.to],
  );
}

async function readBilledAnthropicDaily(
  pool: Pool,
  interval: SpendWindow["interval"],
) {
  return optionalTableRows(
    pool,
    `SELECT bucket_date::text AS bucket_date, SUM(cost_usd)::float8 AS cost_usd
       FROM pipeline.anthropic_cost_daily
      WHERE bucket_date >= $1::date AND bucket_date <= $2::date
      GROUP BY bucket_date ORDER BY bucket_date DESC`,
    [interval.from, interval.to],
  );
}

/** What Anthropic actually billed, plus the metered days it has not billed yet. */
export async function readAnthropicSpend(pool: Pool, win: SpendWindow) {
  const { interval } = win;
  const totals = await readBilledAnthropicTotals(pool, interval);
  const billedByModel = await readBilledAnthropicByModel(pool, interval);
  const billedDaily = await readBilledAnthropicDaily(pool, interval);
  const unbilled = await readUnbilledAnthropicSpend(
    pool,
    win,
    totals.billedThrough,
  );

  return {
    available: totals.available,
    total_usd: totals.totalUsd,
    input_tokens: totals.inputTokens,
    output_tokens: totals.outputTokens,
    as_of: totals.asOf,
    billed_through: totals.billedThrough,
    by_model: billedByModel,
    daily: billedDaily,
    unbilled_usd: unbilled.costUsd,
    unbilled_days: unbilled.days,
  };
}
