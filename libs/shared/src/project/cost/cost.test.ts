import { describe, it, expect } from "vitest";
import { PgCost, PgGcpCost } from "./cost-pg.js";
import { InMemoryCost, InMemoryGcpCost } from "./cost-memory.js";
import type { AnthropicCostDailyRow, GcpCostDailyRow } from "./cost-port.js";
import type { PgPool } from "../../memory-store.js";

function fakePool(): {
  pool: PgPool;
  calls: Array<{ text: string; params?: unknown[] }>;
} {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const pool: PgPool = {
    async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
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

function sampleGcpRow(): GcpCostDailyRow {
  return {
    bucketDate: "2026-09-01",
    service: "Kubernetes Engine",
    costUsd: 14.62,
    creditsUsd: -1.31,
  };
}

describe("PgGcpCost adapter", () => {
  it("upserts into pipeline.gcp_cost_daily keyed on (bucket_date, service)", async () => {
    const { pool, calls } = fakePool();

    await new PgGcpCost(pool).upsertGcpDaily(sampleGcpRow());

    expect(calls[0]?.text).toContain("INSERT INTO pipeline.gcp_cost_daily");
    expect(calls[0]?.text).toContain(
      "ON CONFLICT (bucket_date, service) DO UPDATE SET",
    );
    expect(calls[0]?.params).toEqual([
      "2026-09-01",
      "Kubernetes Engine",
      14.62,
      -1.31,
    ]);
  });
});

describe("InMemoryGcpCost double", () => {
  it("appends a new row for an unseen (bucketDate, service) pair", async () => {
    const cost = new InMemoryGcpCost();

    await cost.upsertGcpDaily(sampleGcpRow());

    expect(cost.rows).toEqual([sampleGcpRow()]);
  });

  it("replaces the existing row sharing the same (bucketDate, service) key", async () => {
    const cost = new InMemoryGcpCost();

    await cost.upsertGcpDaily(sampleGcpRow());

    await cost.upsertGcpDaily({ ...sampleGcpRow(), costUsd: 20.01 });

    expect(cost.rows).toEqual([{ ...sampleGcpRow(), costUsd: 20.01 }]);
  });

  it("keeps separate rows for the same date across different services", async () => {
    const cost = new InMemoryGcpCost();

    await cost.upsertGcpDaily(sampleGcpRow());

    await cost.upsertGcpDaily({ ...sampleGcpRow(), service: "Networking" });

    expect(cost.rows).toEqual([
      sampleGcpRow(),
      { ...sampleGcpRow(), service: "Networking" },
    ]);
  });
});
