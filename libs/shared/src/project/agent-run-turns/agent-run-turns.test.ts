import { describe, it, expect } from "vitest";
import { InMemoryAgentRunTurns } from "./agent-run-turns-memory.js";
import { PgAgentRunTurns } from "./agent-run-turns-pg.js";
import type { PgPool } from "../../memory-store.js";
import type { AgentRunTurnInsert } from "./agent-run-turns-port.js";

function fakePool(rowsByCall: unknown[][] = []): {
  pool: PgPool;
  calls: Array<{ text: string; params?: unknown[] }>;
} {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const pool: PgPool = {
    async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
      calls.push({ text, params });

      return { rows: (rowsByCall[calls.length - 1] ?? []) as T[] };
    },
  };

  return { pool, calls };
}

function turn(over: Partial<AgentRunTurnInsert> = {}): AgentRunTurnInsert {
  return {
    taskId: "task-9",
    agentCrName: "abc123def456-review",
    eventType: "assistant",
    payload: {
      type: "assistant",
      message: { content: [{ type: "text", text: "x" }] },
    },
    ...over,
  };
}

describe("InMemoryAgentRunTurns", () => {
  it("stores the full payload untruncated with the same write-time correlation as the projection", async () => {
    const turns = new InMemoryAgentRunTurns();

    turns.registerNode({
      agentCrName: "abc123def456-review",
      assemblyLineId: "al-1",
      nodeId: "review",
      iteration: 1,
    });
    const bigText = "x".repeat(64 * 1024);
    const inserted = await turns.insertBatch([
      turn({ payload: { type: "assistant", text: bigText } }),
    ]);

    expect(inserted).toBe(1);
    expect(turns.rows[0]).toMatchObject({
      taskId: "task-9",
      assemblyLineId: "al-1",
      nodeId: "review",
      iteration: 1,
      eventType: "assistant",
    });
    expect(turns.rows[0]?.payload.text).toBe(bigText);
  });

  it("keeps an uncorrelated row with the correlated fields null rather than dropping it", async () => {
    const turns = new InMemoryAgentRunTurns();

    await turns.insertBatch([turn({ agentCrName: "unknown-cr" })]);

    expect(turns.rows[0]).toMatchObject({
      agentCrName: "unknown-cr",
      assemblyLineId: null,
      nodeId: null,
      iteration: null,
    });
  });

  it("inserts nothing for an empty batch", async () => {
    const turns = new InMemoryAgentRunTurns();

    expect(await turns.insertBatch([])).toBe(0);
    expect(turns.rows).toEqual([]);
  });

  it("lists a line's turns ascending by id", async () => {
    const turns = new InMemoryAgentRunTurns();

    turns.registerNode({
      agentCrName: "abc123def456-review",
      assemblyLineId: "al-1",
      nodeId: "review",
      iteration: 1,
    });
    await turns.insertBatch([
      turn({ eventType: "system" }),
      turn({ eventType: "assistant" }),
      turn({ agentCrName: null, eventType: "log" }),
    ]);

    expect(
      (await turns.listForAssemblyLine("al-1", 100)).map((r) => r.eventType),
    ).toEqual(["system", "assistant"]);
  });

  it("prunes turns older than the retention horizon and keeps the rest", async () => {
    let clock = new Date("2026-08-01T00:00:00Z");
    const turns = new InMemoryAgentRunTurns({ now: () => clock });

    await turns.insertBatch([turn()]);
    clock = new Date("2026-11-15T00:00:00Z");
    await turns.insertBatch([turn()]);

    expect(await turns.pruneOld(90)).toBe(1);
    expect(turns.rows).toHaveLength(1);
  });
});

describe("PgAgentRunTurns", () => {
  it("binds the batch as a single jsonb parameter and correlates via the node lateral join", async () => {
    const { pool, calls } = fakePool([[{ count: 2 }]]);

    await new PgAgentRunTurns(pool).insertBatch([turn(), turn()]);

    expect(calls).toHaveLength(1);
    const sql = calls[0]?.text ?? "";

    expect(sql).toContain("INSERT INTO pipeline.agent_run_turns");
    expect(sql).toContain("jsonb_to_recordset($1::jsonb)");
    expect(sql).toContain("LEFT JOIN LATERAL");
    expect(calls[0]?.params).toHaveLength(1);
  });

  it("issues no query for an empty batch", async () => {
    const { pool, calls } = fakePool();

    expect(await new PgAgentRunTurns(pool).insertBatch([])).toBe(0);
    expect(calls).toEqual([]);
  });

  it("prunes on the created_at horizon", async () => {
    const { pool, calls } = fakePool([[{ count: 7 }]]);

    expect(await new PgAgentRunTurns(pool).pruneOld(90)).toBe(7);
    expect(calls[0]?.text).toContain("DELETE FROM pipeline.agent_run_turns");
    expect(calls[0]?.params).toEqual([90]);
  });
});
