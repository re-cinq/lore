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
  it("searches memories and facts for 'split OR port OR lore-api' with websearch_to_tsquery ranked by ts_rank, not ILIKE by created_at", async () => {
    const pool = scriptedPool();

    await searchMemories(pool, "split the port for lore-api");

    const keywordCalls = pool.calls.filter((c) =>
      /websearch_to_tsquery\('english', \$1\)/.test(c.sql),
    );

    expect(
      keywordCalls.map((c) => ({
        terms: c.params[0],
        ranked: /ORDER BY ts_rank\(/.test(c.sql),
        legacy: /ILIKE|created_at DESC/.test(c.sql),
      })),
    ).toEqual([
      { terms: "split OR port OR lore-api", ranked: true, legacy: false },
      { terms: "split OR port OR lore-api", ranked: true, legacy: false },
    ]);
  });

  it("runs only the fact legs with $4 = ['episode'] and never the memories table when sources is ['episode'], returning the 2 episode rows", async () => {
    const row = (id: string, rank: number) => ({
      id,
      key: id,
      value: `about ${id}`,
      agent_id: "a1",
      source: "episode",
      kw_rank: String(rank),
    });
    const pool = scriptedPool((sql) =>
      factKeywordQuery({ sql, params: [] }) ? [row("e1", 1), row("e2", 2)] : [],
    );

    const results = await searchMemories(pool, "deploy", {
      limit: 5,
      sources: ["episode"],
    });

    expect({
      memoriesQueried: pool.calls.some((c) =>
        /FROM memory\.memories m/.test(c.sql),
      ),
      factCalls: pool.calls.filter(factKeywordQuery).map((c) => ({
        gated: /= ANY\(\$4::text\[\]\)/.test(c.sql),
        sources: c.params[3],
      })),
      hits: results.map((r) => [r.key, r.source]),
    }).toEqual({
      memoriesQueried: false,
      factCalls: [{ gated: true, sources: ["episode"] }],
      hits: [
        ["e1", "episode"],
        ["e2", "episode"],
      ],
    });
  });

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
      if (
        /FROM memory\.memories m/.test(sql) &&
        /websearch_to_tsquery/.test(sql)
      ) {
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
      /FROM memory\.memories m/.test(sql) && /websearch_to_tsquery/.test(sql)
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

  it("returns empty when the named pool does not exist", async () => {
    const pool = scriptedPool();

    const results = await searchMemories(pool, "deploy gotcha", {
      poolName: "ghost-pool",
    });

    expect(results).toEqual([]);
  });

  it("resolves the pool by name before searching", async () => {
    const pool = scriptedPool();

    await searchMemories(pool, "deploy gotcha", { poolName: "ghost-pool" });

    expect(pool.calls[0]).toMatchObject({ params: ["ghost-pool"] });
    expect(pool.calls[0].sql).toMatch(
      /FROM memory\.shared_pools WHERE name = \$1/,
    );
  });
});
