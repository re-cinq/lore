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
 * The reporting window, aligned to UTC day boundaries and bounded at both ends.
 *
 * Both halves matter and both were wrong:
 *
 * - **Span.** `now - 31d` through now covers 31 whole days *plus the current
 *   one* — 32 daily buckets against a documented maximum of 31. The API
 *   returned the oldest 31 and dropped today, so the month-to-date total
 *   silently excluded the current day, every day, permanently. The window is
 *   now today plus the previous 30 days: exactly 31 buckets, today always in.
 * - **`ending_at`.** Previously omitted; every example in the Usage & Cost API
 *   docs supplies it. Ending at tomorrow's UTC midnight makes the in-progress
 *   day an explicit, whole final bucket rather than leaving the boundary to
 *   the server's default.
 *
 * Aligned to UTC midnight because the buckets the API reports are UTC days —
 * an unaligned `starting_at` puts every bucket boundary mid-day, which does not
 * match what `bucket_date` means downstream in `pipeline.anthropic_cost_daily`.
 */
export function reportWindow(now: Date): {
  starting_at: string;
  ending_at: string;
} {
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  return {
    starting_at: new Date(
      today - (SYNC_WINDOW_DAYS - 1) * DAY_MS,
    ).toISOString(),
    ending_at: new Date(today + DAY_MS).toISOString(),
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
 * The 31-day cost+usage pull, shared by the nightly cron and the /spend page's
 * live read (`routes/anthropic-cost-live.ts`). Extracted so the two callers
 * cannot drift on window, bucket width, or merge semantics — the page would
 * otherwise show subtly different totals from the rollup it falls back to.
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
