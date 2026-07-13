import { describe, it, expect } from "vitest";
import { PgCost } from "./cost-pg.js";
import { InMemoryCost } from "./cost-memory.js";
import type { AnthropicCostDailyRow } from "./cost-port.js";
import type { PgPool } from "../../memory-store.js";

function fakePool(): {
  pool: PgPool;
  calls: Array<{ text: string; params?: unknown[] }>;
} {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const pool: PgPool = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      return { rows: [] };
    },
  };
  return { pool, calls };
}

function sampleRow(): AnthropicCostDailyRow {
  return {
    bucketDate: "2026-06-30",
    model: "claude-opus-4-8",
    costUsd: 12.5,
    inputTokens: 1000,
    outputTokens: 200,
    cacheCreationTokens: 50,
    cacheReadTokens: 300,
  };
}

describe("PgCost adapter", () => {
  it("upserts into pipeline.anthropic_cost_daily keyed on (bucket_date, model)", async () => {
    const { pool, calls } = fakePool();

    await new PgCost(pool).upsertDaily(sampleRow());

    expect(calls[0]?.text).toContain(
      "INSERT INTO pipeline.anthropic_cost_daily",
    );
    expect(calls[0]?.text).toContain(
      "ON CONFLICT (bucket_date, model) DO UPDATE SET",
    );
    expect(calls[0]?.params).toEqual([
      "2026-06-30",
      "claude-opus-4-8",
      12.5,
      1000,
      200,
      50,
      300,
    ]);
  });
});

describe("InMemoryCost double", () => {
  it("appends a new row for an unseen (bucketDate, model) pair", async () => {
    const cost = new InMemoryCost();

    await cost.upsertDaily(sampleRow());

    expect(cost.rows).toEqual([sampleRow()]);
  });

  it("replaces the existing row sharing the same (bucketDate, model) key", async () => {
    const cost = new InMemoryCost();
    await cost.upsertDaily(sampleRow());

    await cost.upsertDaily({ ...sampleRow(), costUsd: 99, inputTokens: 4000 });

    expect(cost.rows).toEqual([
      { ...sampleRow(), costUsd: 99, inputTokens: 4000 },
    ]);
  });

  it("keeps separate rows for the same date across different models", async () => {
    const cost = new InMemoryCost();
    await cost.upsertDaily(sampleRow());

    await cost.upsertDaily({ ...sampleRow(), model: "claude-haiku-4-8" });

    expect(cost.rows).toEqual([
      sampleRow(),
      { ...sampleRow(), model: "claude-haiku-4-8" },
    ]);
  });
});
