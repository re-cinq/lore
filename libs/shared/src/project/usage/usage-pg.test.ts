import { describe, it, expect } from "vitest";
import { PgUsage } from "./usage-pg.js";
import type { PgPool } from "../../memory-store.js";

function fakePool(returnRows: unknown[] = []): {
  pool: PgPool;
  calls: Array<{ text: string; params?: unknown[] }>;
} {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const pool: PgPool = {
    async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
      calls.push({ text, params });

      return { rows: returnRows as T[] };
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
      null,
      "claude-code",
      "claude-sonnet-4-6",
      100,
      250,
      0,
      1500,
      "success",
      null,
      // $11/$12 — the carried identity, null when the producer stated none.
      null,
      null,
    ]);
  });

  it("routes the id to task_id and resolves assembly_run_id from the CR name at insert", async () => {
    const { pool, calls } = fakePool();

    await new PgUsage(pool).logLlmCall({
      taskId: "d6f1c2a0-0000-0000-0000-000000000000",
      agentCrName: "abc12345-review",
      jobName: "agent",
      model: "claude-sonnet-4-6",
      inputTokens: 1,
      outputTokens: 2,
      costUsd: 0.5,
      durationMs: 10,
    });

    expect(calls[0]?.text).toContain(
      "LEFT JOIN pipeline.tasks t ON t.id = g.given",
    );
    expect(calls[0]?.text).toContain(
      "LEFT JOIN pipeline.assembly_runs al ON al.id = g.given AND t.id IS NULL",
    );
    expect(calls[0]?.text).toContain("n.agent_cr_name = g.cr");
    expect(calls[0]?.text).toContain("COALESCE(node.assembly_run_id, al.id)");
    expect(calls[0]?.params?.[0]).toBe("d6f1c2a0-0000-0000-0000-000000000000");
    expect(calls[0]?.params?.[1]).toBe("abc12345-review");
    expect(calls[0]?.params?.[6]).toBe(0.5);
  });

  it("prefers a carried identity and skips the CR-name lateral for that row", async () => {
    const { pool, calls } = fakePool();

    await new PgUsage(pool).logLlmCall({
      taskId: "d6f1c2a0-0000-0000-0000-000000000000",
      agentCrName: "abc12345-review",
      model: "claude-sonnet-4-6",
      inputTokens: 1,
      outputTokens: 2,
      durationMs: 10,
      carried: {
        assemblyLineId: "11111111-2222-4333-8444-555555555555",
        nodeId: "review",
        iteration: 1,
        stationRunId: "99999999-2222-4333-8444-555555555555",
      },
    });

    expect(calls[0]?.text).toContain("$11::uuid IS NULL");
    expect(calls[0]?.params?.[10]).toBe("11111111-2222-4333-8444-555555555555");
    expect(calls[0]?.params?.[11]).toBe("99999999-2222-4333-8444-555555555555");
  });

  it("passes nulls for an uncarried identity so the lateral stays in charge", async () => {
    const { pool, calls } = fakePool();

    await new PgUsage(pool).logLlmCall({
      model: "claude-sonnet-4-6",
      inputTokens: 1,
      outputTokens: 2,
      durationMs: 10,
    });

    expect(calls[0]?.params?.[10]).toBeNull();
    expect(calls[0]?.params?.[11]).toBeNull();
  });

  it("reports correlated true when the RETURNING row says so", async () => {
    const { pool } = fakePool([{ correlated: true }]);

    const result = await new PgUsage(pool).logLlmCall({
      taskId: "d6f1c2a0-0000-0000-0000-000000000000",
      jobName: "agent",
      model: "m",
      inputTokens: 1,
      outputTokens: 2,
      durationMs: 10,
    });

    expect(result).toEqual({ correlated: true });
  });

  it("reports correlated false when the id matched neither table", async () => {
    const { pool } = fakePool([{ correlated: false }]);

    const result = await new PgUsage(pool).logLlmCall({
      taskId: "00000000-0000-0000-0000-000000000000",
      jobName: "agent",
      model: "m",
      inputTokens: 1,
      outputTokens: 2,
      durationMs: 10,
    });

    expect(result).toEqual({ correlated: false });
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

    expect(calls[0]?.text).toContain("assembly_run_id");
    expect(calls[0]?.params?.[0]).toBeNull();
  });

  it("passes a null CR through the lateral when agentCrName is omitted", async () => {
    const { pool, calls } = fakePool();

    await new PgUsage(pool).logLlmCall({
      taskId: "d6f1c2a0-0000-0000-0000-000000000000",
      jobName: "agent",
      model: "m",
      inputTokens: 1,
      outputTokens: 2,
      durationMs: 10,
    });

    // The lateral clause is still emitted; a null CR simply resolves no node
    // and COALESCE falls back to al.id (verified against Postgres, not here).
    expect(calls[0]?.text).toContain("n.agent_cr_name = g.cr");
    expect(calls[0]?.params?.[1]).toBeNull();
  });

  it("writes status failed and the error message through the routing insert", async () => {
    const { pool, calls } = fakePool();

    await new PgUsage(pool).logLlmCall({
      taskId: "d6f1c2a0-0000-0000-0000-000000000000",
      jobName: "auto-curation",
      model: "claude-haiku-4-5-20251001",
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 42,
      status: "failed",
      error: "credit balance too low",
    });

    expect(calls[0]?.text).toContain("status, error");
    expect(calls[0]?.params?.[8]).toBe("failed");
    expect(calls[0]?.params?.[9]).toBe("credit balance too low");
  });
});
