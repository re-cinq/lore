import { describe, it, expect, vi } from "vitest";

vi.mock("../../embeddings/embedding-service.js", () => ({
  getQueryEmbedding: async () => [0.1, 0.2],
}));

import { fetchers } from "./context-assembly-fetchers.js";
import { searchMemories } from "./memory-search.js";

function scriptedPool(route: (sql: string) => unknown[]) {
  return {
    query: async <T>(sql: string): Promise<{ rows: T[] }> => ({
      rows: route(sql) as T[],
    }),
  };
}

const memory = (key: string, rank: Record<string, string>) => ({
  id: key,
  key,
  value: `about ${key}`,
  agent_id: "a1",
  source: "memory",
  ...rank,
});

const isVectorMemories = (sql: string) =>
  /FROM memory\.memories m/.test(sql) && /vec_rank/.test(sql);
const isKeywordMemories = (sql: string) =>
  /FROM memory\.memories m/.test(sql) && /kw_rank/.test(sql);

const twentyNeighbours = Array.from({ length: 20 }, (_, index) =>
  memory(`near-${index + 1}`, {
    vec_rank: String(index + 1),
    similarity: String(0.8 - index * 0.01),
  }),
);

describe("searchMemories similarity", () => {
  it("returns the cosine similarity 0.71 the vector leg measured for a memory", async () => {
    const pool = scriptedPool((sql) =>
      isVectorMemories(sql)
        ? [memory("m1", { vec_rank: "1", similarity: "0.71" })]
        : [],
    );

    const results = await searchMemories(pool, "deploy", { passive: true });

    expect(results).toEqual([
      expect.objectContaining({ key: "m1", similarity: 0.71 }),
    ]);
  });

  it("gives a keyword-only memory the similarity of the 20th neighbour, 0.61, as the most it can be", async () => {
    const pool = scriptedPool((sql) => {
      if (isVectorMemories(sql)) {
        return twentyNeighbours;
      }

      return isKeywordMemories(sql)
        ? [memory("by-word", { kw_rank: "1" })]
        : [];
    });

    const results = await searchMemories(pool, "deploy", {
      passive: true,
      limit: 30,
    });

    expect(
      results.find((result) => result.key === "by-word")?.similarity,
    ).toBeCloseTo(0.61, 5);
  });

  it("leaves a keyword-only memory unmeasured when the vector leg returned fewer than its 20", async () => {
    const pool = scriptedPool((sql) => {
      if (isVectorMemories(sql)) {
        return twentyNeighbours.slice(0, 5);
      }

      return isKeywordMemories(sql)
        ? [memory("by-word", { kw_rank: "1" })]
        : [];
    });

    const results = await searchMemories(pool, "deploy", {
      passive: true,
      limit: 30,
    });

    expect(
      results.find((result) => result.key === "by-word"),
    ).not.toHaveProperty("similarity");
  });
});

describe("fetchers.memories similarity", () => {
  it("carries a memory's similarity 0.71 onto its context item, so the relevance cut-off can weigh it", async () => {
    const pool = scriptedPool((sql) =>
      isVectorMemories(sql)
        ? [memory("m1", { vec_rank: "1", similarity: "0.71" })]
        : [],
    );

    const res = await fetchers.memories(pool, "deploy", undefined, {
      passive: true,
    });

    expect(res.sources).toEqual([
      expect.objectContaining({ source_path: "m1", similarity: 0.71 }),
    ]);
  });
});
