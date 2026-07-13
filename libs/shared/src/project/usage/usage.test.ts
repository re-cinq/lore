import { describe, it, expect } from "vitest";
import { Usage } from "./usage.js";
import { PgUsage } from "./usage-pg.js";
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

describe("PgUsage adapter", () => {
  it("inserts an llm_calls row, defaulting cost and null task", async () => {
    const { pool, calls } = fakePool();

    await new Usage(new PgUsage(pool)).logLlmCall({
      jobName: "claude-code",
      model: "claude-sonnet-4-6",
      inputTokens: 100,
      outputTokens: 250,
      durationMs: 1500,
    });

    expect(calls[0]?.text).toContain("INSERT INTO pipeline.llm_calls");
    expect(calls[0]?.params).toEqual([
      null,
      "claude-code",
      "claude-sonnet-4-6",
      100,
      250,
      0,
      1500,
    ]);
  });

  it("returns today and total llm_call counts", async () => {
    const pool: PgPool = {
      async query(text: string) {
        if (text.includes("current_date")) {
          return { rows: [{ today: 3 }] };
        }

        return { rows: [{ total: 42 }] };
      },
    };

    const counts = await new PgUsage(pool).processedCounts();

    expect(counts).toEqual({ today: 3, total: 42 });
  });

  it("defaults missing count rows to zero", async () => {
    const pool: PgPool = {
      async query() {
        return { rows: [] };
      },
    };

    expect(await new PgUsage(pool).processedCounts()).toEqual({
      today: 0,
      total: 0,
    });
  });
});
