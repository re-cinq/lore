import { z } from "zod";
import type { AnthropicCostDailyRow as SharedCostDailyRow } from "@re-cinq/lore-shared/project/cost/cost-port.js";

const CostResult = z.object({
  amount: z.string(),
  model: z.string().nullable().optional(),
});

const CostBucket = z.object({
  starting_at: z.string(),
  results: z.array(CostResult),
});

const CostReport = z.object({
  data: z.array(CostBucket),
});

export interface CostRow {
  date: string;
  model: string;
  costUsd: number;
}

export function parseCostReport(raw: unknown): CostRow[] {
  const report = CostReport.parse(raw);

  return report.data.flatMap((bucket) =>
    bucket.results.map((result) => ({
      date: bucket.starting_at.slice(0, 10),
      model: result.model ?? "",
      costUsd: Number(result.amount) / 100,
    })),
  );
}

const UsageResult = z.object({
  model: z.string().nullable().optional(),
  uncached_input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().optional(),
  cache_creation: z
    .object({
      ephemeral_1h_input_tokens: z.number().optional(),
      ephemeral_5m_input_tokens: z.number().optional(),
    })
    .optional(),
});

const UsageBucket = z.object({
  starting_at: z.string(),
  results: z.array(UsageResult),
});

const UsageReport = z.object({
  data: z.array(UsageBucket),
});

export interface UsageRow {
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/**
 * The merged bucket IS the stored row's upsert shape — one declaration, in
 * `libs/shared/src/models/anthropic-cost-daily.ts`. It used to be restated here
 * with the key spelled `date` while the writer's spelled it `bucketDate`, and
 * the seam between them was a hand-written field rename in the sync.
 */
export type AnthropicCostDailyRow = SharedCostDailyRow;

export function mergeCostAndUsage(
  costRows: CostRow[],
  usageRows: UsageRow[],
): AnthropicCostDailyRow[] {
  const byKey = new Map<string, AnthropicCostDailyRow>();

  const blank = (bucketDate: string, model: string): AnthropicCostDailyRow => ({
    bucketDate,
    model,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  });

  for (const cost of costRows) {
    const key = `${cost.date}|${cost.model}`;
    const row = byKey.get(key) ?? blank(cost.date, cost.model);

    row.costUsd += cost.costUsd;
    byKey.set(key, row);
  }

  for (const usage of usageRows) {
    const key = `${usage.date}|${usage.model}`;
    const row = byKey.get(key) ?? blank(usage.date, usage.model);

    row.inputTokens += usage.inputTokens;
    row.outputTokens += usage.outputTokens;
    row.cacheReadTokens += usage.cacheReadTokens;
    row.cacheCreationTokens += usage.cacheCreationTokens;
    byKey.set(key, row);
  }

  return [...byKey.values()];
}

export function parseUsageReport(raw: unknown): UsageRow[] {
  const report = UsageReport.parse(raw);

  return report.data.flatMap((bucket) =>
    bucket.results.map((result) => ({
      date: bucket.starting_at.slice(0, 10),
      model: result.model ?? "",
      inputTokens: result.uncached_input_tokens ?? 0,
      outputTokens: result.output_tokens ?? 0,
      cacheReadTokens: result.cache_read_input_tokens ?? 0,
      cacheCreationTokens:
        (result.cache_creation?.ephemeral_1h_input_tokens ?? 0) +
        (result.cache_creation?.ephemeral_5m_input_tokens ?? 0),
    })),
  );
}
