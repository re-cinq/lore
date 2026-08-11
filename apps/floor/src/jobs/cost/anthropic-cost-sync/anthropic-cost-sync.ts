import { cost } from "../../../kernel/queues.js";
import {
  parseCostReport,
  parseUsageReport,
  mergeCostAndUsage,
  type AnthropicCostDailyRow,
} from "../anthropic-cost.js";

const ADMIN_BASE = "https://api.anthropic.com/v1/organizations";
const ANTHROPIC_VERSION = "2023-06-01";
// The usage and cost reports cap 1d buckets at 31 — a documented hard maximum,
// not a default. 31 buckets covers any calendar month, so month-to-date is
// always fully spanned.
const SYNC_WINDOW_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The reporting window: today's UTC midnight minus 30 days, and deliberately
 * no `ending_at`.
 *
 * - **Span.** The old `now - 31d` start spanned 31 whole days *plus* the
 *   current one — 32 candidate daily buckets against the API's documented
 *   hard maximum of 31 (`limit` docs), leaving which bucket survives to the
 *   server's truncation choice. Starting at today − 30d leaves exactly 31
 *   candidates, so `limit: 31` can never truncate anything.
 * - **No `ending_at`.** The API reference defines it as "time buckets that
 *   *end before* this timestamp" — strictly before. Today's bucket ends AT
 *   tomorrow's midnight, so an `ending_at` of tomorrow-midnight excludes the
 *   current day by construction (verified against the live API: the same
 *   window with that bound came back one bucket short). Omitting it leaves
 *   today's bucket eligible whenever the API emits it.
 * - **UTC midnight alignment**, because the API snaps buckets to UTC days and
 *   an unaligned `starting_at` would not match what `bucket_date` means
 *   downstream in `pipeline.anthropic_cost_daily`.
 */
export function reportWindow(now: Date): { starting_at: string } {
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  return {
    starting_at: new Date(
      today - (SYNC_WINDOW_DAYS - 1) * DAY_MS,
    ).toISOString(),
  };
}

async function fetchAllBuckets(
  endpoint: string,
  baseParams: Record<string, string>,
  groupBy: string,
  adminKey: string,
): Promise<unknown[]> {
  const buckets: unknown[] = [];
  let page: string | null = null;

  do {
    const url = new URL(`${ADMIN_BASE}/${endpoint}`);

    for (const [key, value] of Object.entries(baseParams)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.append("group_by[]", groupBy);

    if (page) {
      url.searchParams.set("page", page);
    }

    const res = await fetch(url, {
      headers: {
        "x-api-key": adminKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
    });

    if (!res.ok) {
      throw new Error(
        `Anthropic ${endpoint} returned ${res.status}: ${await res.text()}`,
      );
    }

    const body = (await res.json()) as {
      data?: unknown[];
      has_more?: boolean;
      next_page?: string | null;
    };

    if (Array.isArray(body.data)) {
      buckets.push(...body.data);
    }
    page = body.has_more ? (body.next_page ?? null) : null;
  } while (page);

  return buckets;
}

function upsertRow(row: AnthropicCostDailyRow): Promise<void> {
  return cost().upsertDaily({
    bucketDate: row.date,
    model: row.model,
    costUsd: row.costUsd,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheCreationTokens: row.cacheCreationTokens,
    cacheReadTokens: row.cacheReadTokens,
  });
}

/**
 * The 31-day cost+usage pull behind the daily sync. Extracted from the job
 * body so the window/bucket/merge mechanics are testable without a database.
 */
export async function fetchAnthropicCostRows(
  adminKey: string,
): Promise<AnthropicCostDailyRow[]> {
  const baseParams = {
    ...reportWindow(new Date()),
    bucket_width: "1d",
    limit: String(SYNC_WINDOW_DAYS),
  };

  const [costBuckets, usageBuckets] = await Promise.all([
    fetchAllBuckets("cost_report", baseParams, "description", adminKey),
    fetchAllBuckets("usage_report/messages", baseParams, "model", adminKey),
  ]);

  return mergeCostAndUsage(
    parseCostReport({ data: costBuckets }),
    parseUsageReport({ data: usageBuckets }),
  );
}

export async function anthropicCostSyncJob(): Promise<string> {
  const adminKey = process.env.ANTHROPIC_ADMIN_KEY;

  if (!adminKey) {
    return "ANTHROPIC_ADMIN_KEY not set; skipping Anthropic org cost sync";
  }

  const merged = await fetchAnthropicCostRows(adminKey);

  await Promise.all(merged.map(upsertRow));

  const total = merged.reduce((sum, row) => sum + row.costUsd, 0);

  return `Synced ${merged.length} day/model rows over ${SYNC_WINDOW_DAYS}d ($${total.toFixed(2)} billed)`;
}
