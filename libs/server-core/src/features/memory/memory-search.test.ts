import { describe, it, expect, vi } from "vitest";
import { searchMemories } from "./memory-search.js";

// searchMemories is heavy live-IO (Vertex embeddings + multi-query RRF), so
// only its deterministic control-flow branch is unit-tested here: when a named
// shared pool does not exist the search short-circuits to an empty result and
// never runs the vector/keyword queries. The ranking core (rrfMerge/diversify)
// that powers the populated path is covered in shared/memory-ranking.test.ts.

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

    const results = await searchMemories(
      pool,
      "deploy gotcha",
      undefined,
      "ghost-pool",
    );

    expect(results).toEqual([]);
  });

  it("resolves the pool by name before searching", async () => {
    const pool = poolWithNoSuchPool();

    await searchMemories(pool, "deploy gotcha", undefined, "ghost-pool");

    expect(pool.calls[0]).toMatchObject({
      params: ["ghost-pool"],
    });
    expect(pool.calls[0].sql).toMatch(
      /FROM memory\.shared_pools WHERE name = \$1/,
    );
  });
});
