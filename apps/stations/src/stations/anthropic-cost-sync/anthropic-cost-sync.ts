import type { CostPort } from "@re-cinq/lore-shared/project/cost/cost-port.js";
import {
  parseCostReport,
  parseUsageReport,
  mergeCostAndUsage,
  type AnthropicCostDailyRow,
} from "./anthropic-cost.js";

const ADMIN_BASE = "https://api.anthropic.com/v1/organizations";
const ANTHROPIC_VERSION = "2023-06-01";
// The usage/cost reports cap 1d buckets at 31 — a documented hard maximum, not a default; 31 buckets always fully spans a calendar month.
const SYNC_WINDOW_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;

// Reporting window: today's UTC midnight minus 30 days, no `ending_at` (its strictly-before semantics would exclude today's bucket) — leaves exactly 31 candidates so `limit: 31` never truncates; aligned to UTC midnight to match `bucket_date` downstream.
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

function bucketPageUrl(
  endpoint: string,
  baseParams: Record<string, string>,
  groupBy: string,
  page: string | null,
): URL {
  const url = new URL(`${ADMIN_BASE}/${endpoint}`);

  for (const [key, value] of Object.entries(baseParams)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.append("group_by[]", groupBy);

  if (page) {
    url.searchParams.set("page", page);
  }

  return url;
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
    const url = bucketPageUrl(endpoint, baseParams, groupBy, page);

    const res = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
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

// The 31-day cost+usage pull behind the daily sync, extracted so window/bucket/merge mechanics are testable without a database.
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

export async function anthropicCostSyncJob(
  costs: CostPort,
  adminKey = process.env.ANTHROPIC_ADMIN_KEY,
): Promise<string> {
  if (!adminKey) {
    return "ANTHROPIC_ADMIN_KEY not set; skipping Anthropic org cost sync";
  }

  const merged = await fetchAnthropicCostRows(adminKey);

  await Promise.all(merged.map((row) => costs.upsertDaily(row)));

  const total = merged.reduce((sum, row) => sum + row.costUsd, 0);

  return `Synced ${merged.length} day/model rows over ${SYNC_WINDOW_DAYS}d ($${total.toFixed(2)} billed)`;
}
