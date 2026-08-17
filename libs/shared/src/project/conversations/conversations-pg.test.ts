import { describe, it, expect } from "vitest";
import { PgConversations } from "./conversations-pg.js";
import type { PgPool } from "../lib/pg-pool.js";

function fakePool(): {
  pool: PgPool;
  calls: Array<{ text: string; params?: unknown[] }>;
} {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const pool: PgPool = {
    async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
      calls.push({ text, params });

      return { rows: [] as T[] };
    },
  };

  return { pool, calls };
}

/**
 * SQL TEXT, deliberately — the behavioural suite runs against the in-memory
 * double, which answers to any column name at all. `agent_conversations` was
 * never part of the AssemblyRun rename and keeps `assembly_line_id`: a renamed
 * column on a table that keeps its own name has no compat view to hide behind, so
 * a rolled-back writer's insert fails whole rather than degrading. These pin the
 * name against a future sweep, since the failure would be a runtime 42703 that no
 * type check and no mocked pool can see.
 */
describe("PgConversations column names", () => {
  const thread = {
    kind: "args",
    value: "feature-1",
    nodeId: "analyze",
  } as const;

  it("reserve writes the assembly_line_id column", async () => {
    const { pool, calls } = fakePool();

    await new PgConversations(pool).reserve({
      thread,
      conversationId: "c1",
      assemblyLineId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    });

    expect(calls[0]?.text).toContain("assembly_line_id");
    expect(calls[0]?.text).not.toContain("assembly_run_id");
  });

  it("latestFor reads the assembly_line_id column when excluding a run", async () => {
    const { pool, calls } = fakePool();

    await new PgConversations(pool).latestFor(thread, {
      exclude: {
        assemblyLineId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        iteration: 1,
      },
    });

    const sql = calls.map((c) => c.text).join("\n");

    expect(sql).toContain("assembly_line_id");
    expect(sql).not.toContain("assembly_run_id");
  });
});
