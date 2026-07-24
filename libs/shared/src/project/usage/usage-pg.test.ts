import { describe, it, expect } from "vitest";
import { PgUsage } from "./usage-pg.js";
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

describe("PgUsage adapter", () => {
  it("inserts an llm_calls row, defaulting cost and null task", async () => {
    const { pool, calls } = fakePool();

    await new PgUsage(pool).logLlmCall({
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

  it("routes the incoming id to task_id or assembly_line_id at insert", async () => {
    const { pool, calls } = fakePool();

    await new PgUsage(pool).logLlmCall({
      taskId: "d6f1c2a0-0000-0000-0000-000000000000",
      jobName: "agent",
      model: "claude-sonnet-4-6",
      inputTokens: 1,
      outputTokens: 2,
      costUsd: 0.5,
      durationMs: 10,
    });

    expect(calls[0]?.text).toContain("assembly_line_id");
    expect(calls[0]?.text).toContain(
      "LEFT JOIN pipeline.tasks t ON t.id = g.given",
    );
    expect(calls[0]?.text).toContain(
      "LEFT JOIN pipeline.assembly_lines al ON al.id = g.given AND t.id IS NULL",
    );
    expect(calls[0]?.params?.[0]).toBe("d6f1c2a0-0000-0000-0000-000000000000");
    expect(calls[0]?.params?.[5]).toBe(0.5);
  });

  it("returns today and total llm_call counts", async () => {
    const pool: PgPool = {
      async query<T>(text: string): Promise<{ rows: T[] }> {
        if (text.includes("current_date")) {
          return { rows: [{ today: 3 }] as T[] };
        }

        return { rows: [{ total: 42 }] as T[] };
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

  it("passes a null id through the routing insert when taskId is null", async () => {
    const { pool, calls } = fakePool();

    await new PgUsage(pool).logLlmCall({
      taskId: null,
      jobName: "agent",
      model: "claude-sonnet-4-6",
      inputTokens: 1,
      outputTokens: 2,
      costUsd: 0.5,
      durationMs: 10,
    });

    expect(calls[0]?.text).toContain("assembly_line_id");
    expect(calls[0]?.params?.[0]).toBeNull();
  });
});
