/**
 * Live Anthropic cost for /spend, read through the Floor's
 * `GET /api/anthropic-cost/live` rather than by calling Anthropic here — the
 * `sk-ant-admin` key is org-wide billing access and stays in `lore-floor`.
 *
 * `aggregateMonthToDate` reproduces the three month-to-date SQL rollups the
 * page already runs against `pipeline.anthropic_cost_daily`, so the live view
 * and the DB fallback are the same shapes and the same arithmetic. It is kept
 * pure (month boundary passed in, never read from the clock) so the rollups are
 * testable without freezing time.
 */

import type {
  OrgMtdRow,
  OrgByModelRow,
  OrgDailyRow,
} from "@/app/spend/SpendView";

/** One day/model row as the Floor serializes `AnthropicCostDailyRow`. */
export interface LiveCostRow {
  date: string;
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface LiveCostPayload {
  rows: LiveCostRow[];
  fetchedAt: string;
}

export interface OrgRollups {
  orgMtd: OrgMtdRow;
  orgByModel: OrgByModelRow[];
  orgDaily: OrgDailyRow[];
}

/** First day of `now`'s month in UTC as `YYYY-MM-DD`, matching the SQL's
 * `date_trunc('month', current_date)` against a UTC database. */
export function monthStart(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function aggregateMonthToDate(
  rows: LiveCostRow[],
  fetchedAt: string,
  from: string,
): OrgRollups {
  // String comparison is safe and cheap here: both sides are zero-padded
  // ISO `YYYY-MM-DD`, so lexical order is chronological order.
  const inMonth = rows.filter((row) => row.date >= from);

  const byModel = new Map<string, OrgByModelRow>();
  const byDay = new Map<string, number>();

  for (const row of inMonth) {
    const model = byModel.get(row.model) ?? {
      model: row.model,
      cost_usd: 0,
      input_tokens: 0,
      output_tokens: 0,
    };

    model.cost_usd += row.costUsd;
    model.input_tokens += row.inputTokens;
    model.output_tokens += row.outputTokens;
    byModel.set(row.model, model);

    byDay.set(row.date, (byDay.get(row.date) ?? 0) + row.costUsd);
  }

  return {
    orgMtd: {
      billed_usd: inMonth.reduce((sum, row) => sum + row.costUsd, 0),
      input_tokens: inMonth.reduce((sum, row) => sum + row.inputTokens, 0),
      output_tokens: inMonth.reduce((sum, row) => sum + row.outputTokens, 0),
      // Null when the month has no rows, mirroring `MAX(fetched_at)` over an
      // empty set — otherwise a successful fetch of an empty month would read
      // as "data available" and hide the empty state.
      as_of: inMonth.length > 0 ? fetchedAt : null,
    },
    orgByModel: [...byModel.values()].sort((a, b) => b.cost_usd - a.cost_usd),
    orgDaily: [...byDay.entries()]
      .map(([bucket_date, cost_usd]) => ({ bucket_date, cost_usd }))
      .sort((a, b) => b.bucket_date.localeCompare(a.bucket_date)),
  };
}

/**
 * Fetch live cost from the Floor. Returns null on any failure — an unset
 * `LORE_FLOOR_URL`, a 503 because the admin key is absent, a network error, or
 * a malformed body — so the page falls back to the DB rollup rather than
 * throwing. /spend must render even when the Floor is down.
 */
export async function fetchLiveCost(): Promise<LiveCostPayload | null> {
  const floorUrl = process.env.LORE_FLOOR_URL;
  const token = process.env.LORE_INGEST_TOKEN;

  if (!floorUrl || !token) {
    return null;
  }

  try {
    const res = await fetch(`${floorUrl}/api/anthropic-cost/live`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (!res.ok) {
      return null;
    }

    const body = (await res.json()) as Partial<LiveCostPayload>;

    return Array.isArray(body.rows) && typeof body.fetchedAt === "string"
      ? { rows: body.rows, fetchedAt: body.fetchedAt }
      : null;
  } catch {
    return null;
  }
}
