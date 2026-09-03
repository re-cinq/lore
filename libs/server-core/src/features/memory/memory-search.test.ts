import { describe, it, expect, vi } from "vitest";
import { searchMemories } from "./memory-search.js";

function poolWithNoSuchPool() {
  const calls: { sql: string; params: any[] }[] = [];
  const pool = {
    query: vi.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });

      return { rows: [] };
    }),
    calls,
  };

  return pool;
}

describe("searchMemories", () => {
  it("returns empty when the named pool does not exist", async () => {
    const pool = poolWithNoSuchPool();

    const results = await searchMemories(pool, "deploy gotcha", {
      poolName: "ghost-pool",
    });

    expect(results).toEqual([]);
  });

  it("resolves the pool by name before searching", async () => {
    const pool = poolWithNoSuchPool();

    await searchMemories(pool, "deploy gotcha", { poolName: "ghost-pool" });

    expect(pool.calls[0]).toMatchObject({
      params: ["ghost-pool"],
    });
    expect(pool.calls[0].sql).toMatch(
      /FROM memory\.shared_pools WHERE name = \$1/,
    );
  });
});
