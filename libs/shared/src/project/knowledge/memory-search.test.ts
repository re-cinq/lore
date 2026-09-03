import { describe, it, expect, vi } from "vitest";

vi.mock("../../embeddings/embedding-service.js", () => ({
  getQueryEmbedding: async () => null,
}));

import { searchMemories, strengthenRetrievals } from "./memory-search.js";

type Call = { sql: string; params: unknown[] };

function scriptedPool(route: (sql: string) => unknown[] = () => []) {
  const calls: Call[] = [];
  const pool = {
    query: async <T>(
      sql: string,
      params: unknown[] = [],
    ): Promise<{ rows: T[] }> => {
      calls.push({ sql, params });

      return { rows: route(sql) as T[] };
    },
    calls,
  };

  return pool;
}

const factKeywordQuery = (c: Call) => /FROM memory\.facts f/.test(c.sql);
const edgesQuery = (c: Call) => /FROM memory\.edges/.test(c.sql);

describe("searchMemories", () => {
  it("passes $3 = true and the ($3::boolean OR f.valid_to IS NULL) gate when include_invalidated is true", async () => {
    const pool = scriptedPool();

    await searchMemories(pool, "deploy", { includeInvalidated: true });

    const factCall = pool.calls.find(factKeywordQuery)!;

    expect(factCall.params[2]).toBe(true);
    expect(factCall.sql).toMatch(/\(\$3::boolean OR f\.valid_to IS NULL\)/);
  });

  it("passes $3 = false to restrict facts to valid rows when include_invalidated is false", async () => {
    const pool = scriptedPool();

    await searchMemories(pool, "deploy", { includeInvalidated: false });

    const factCall = pool.calls.find(factKeywordQuery)!;

    expect(factCall.params[2]).toBe(false);
    expect(factCall.sql).toMatch(/\(\$3::boolean OR f\.valid_to IS NULL\)/);
  });

  it("issues the memory.edges augmentation query and returns a graph result when graph_augment is true", async () => {
    const pool = scriptedPool((sql) => {
      if (/FROM memory\.memories m/.test(sql) && /ILIKE/.test(sql)) {
        return [
          {
            id: "m1",
            key: "deploy",
            value: "lore deploy gotcha",
            agent_id: "a1",
            source: "memory",
            kw_rank: "1",
          },
        ];
      }

      if (/FROM memory\.entities/.test(sql)) {
        return [{ name: "lore" }];
      }

      if (edgesQuery({ sql, params: [] })) {
        return [
          {
            source_name: "lore",
            source_type: "service",
            relation_type: "uses",
            target_name: "pgvector",
            target_type: "tech",
          },
        ];
      }

      return [];
    });

    const results = await searchMemories(pool, "deploy", {
      graphAugment: true,
    });

    expect(pool.calls.some(edgesQuery)).toBe(true);
    expect(results.some((r) => r.source === "graph")).toBe(true);
  });

  it("issues no memory.edges augmentation query when graph_augment is false", async () => {
    const pool = scriptedPool((sql) =>
      /FROM memory\.memories m/.test(sql) && /ILIKE/.test(sql)
        ? [
            {
              id: "m1",
              key: "deploy",
              value: "lore deploy gotcha",
              agent_id: "a1",
              source: "memory",
              kw_rank: "1",
            },
          ]
        : [],
    );

    await searchMemories(pool, "deploy", { graphAugment: false });

    expect(pool.calls.some(edgesQuery)).toBe(false);
  });
});

describe("strengthenRetrievals", () => {
  it("revives stale facts to observed and bumps half_life_days by +2 capped at 365", async () => {
    const pool = scriptedPool();

    await strengthenRetrievals(pool, [
      {
        id: "f1",
        key: "k",
        value: "v",
        score: 1,
        agent_id: "a",
        source: "fact",
      },
      {
        id: "m1",
        key: "k2",
        value: "v2",
        score: 1,
        agent_id: "a",
        source: "memory",
      },
    ]);

    const factUpdate = pool.calls.find((c) =>
      /UPDATE memory\.facts/.test(c.sql),
    )!;

    expect(factUpdate.sql).toMatch(
      /confidence = CASE WHEN confidence = 'stale' THEN 'observed' ELSE confidence END/,
    );
    expect(factUpdate.sql).toMatch(
      /half_life_days = LEAST\(COALESCE\(half_life_days, 30\) \+ 2, 365\)/,
    );
    expect(factUpdate.sql).toMatch(/retrieval_count = retrieval_count \+ 1/);
    expect(factUpdate.params).toEqual([["f1"]]);

    const memoryUpdate = pool.calls.find((c) =>
      /UPDATE memory\.memories/.test(c.sql),
    )!;

    expect(memoryUpdate.sql).toMatch(
      /half_life_days = LEAST\(COALESCE\(half_life_days, 60\) \+ 2, 365\)/,
    );
    expect(memoryUpdate.params).toEqual([["m1"]]);
  });
});
