import { query } from "../../../kernel/db.js";
import {
  parseCostReport,
  parseUsageReport,
  mergeCostAndUsage,
  type AnthropicCostDailyRow,
} from "../anthropic-cost.js";

const ADMIN_BASE = "https://api.anthropic.com/v1/organizations";
const ANTHROPIC_VERSION = "2023-06-01";
// The messages usage report caps 1d buckets at 31; a trailing 31-day window
// always covers the current month for the month-to-date dashboard total.
const SYNC_WINDOW_DAYS = 31;

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
    if (page) url.searchParams.set("page", page);

    const res = await fetch(url, {
      headers: { "x-api-key": adminKey, "anthropic-version": ANTHROPIC_VERSION },
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
    if (Array.isArray(body.data)) buckets.push(...body.data);
    page = body.has_more ? body.next_page ?? null : null;
  } while (page);

  return buckets;
}

async function upsertRow(row: AnthropicCostDailyRow): Promise<void> {
  await query(
    `INSERT INTO pipeline.anthropic_cost_daily
       (bucket_date, model, cost_usd, input_tokens, output_tokens,
        cache_creation_tokens, cache_read_tokens, fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (bucket_date, model) DO UPDATE SET
       cost_usd = EXCLUDED.cost_usd,
       input_tokens = EXCLUDED.input_tokens,
       output_tokens = EXCLUDED.output_tokens,
       cache_creation_tokens = EXCLUDED.cache_creation_tokens,
       cache_read_tokens = EXCLUDED.cache_read_tokens,
       fetched_at = now()`,
    [
      row.date,
      row.model,
      row.costUsd,
      row.inputTokens,
      row.outputTokens,
      row.cacheCreationTokens,
      row.cacheReadTokens,
    ],
  );
}

export async function anthropicCostSyncJob(): Promise<string> {
  const adminKey = process.env.ANTHROPIC_ADMIN_KEY;
  if (!adminKey) {
    return "ANTHROPIC_ADMIN_KEY not set; skipping Anthropic org cost sync";
  }

  const startingAt = new Date(
    Date.now() - SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const baseParams = {
    starting_at: startingAt,
    bucket_width: "1d",
    limit: String(SYNC_WINDOW_DAYS),
  };

  const [costBuckets, usageBuckets] = await Promise.all([
    fetchAllBuckets("cost_report", baseParams, "description", adminKey),
    fetchAllBuckets("usage_report/messages", baseParams, "model", adminKey),
  ]);

  const merged = mergeCostAndUsage(
    parseCostReport({ data: costBuckets }),
    parseUsageReport({ data: usageBuckets }),
  );

  await Promise.all(merged.map(upsertRow));

  const total = merged.reduce((sum, row) => sum + row.costUsd, 0);
  return `Synced ${merged.length} day/model rows over ${SYNC_WINDOW_DAYS}d ($${total.toFixed(2)} billed)`;
}
