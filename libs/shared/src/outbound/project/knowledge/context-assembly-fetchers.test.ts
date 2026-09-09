import { describe, it, expect, vi } from "vitest";

vi.mock("../../embeddings/embedding-service.js", () => ({
  getQueryEmbedding: async () => null,
}));

import { fetchers } from "./context-assembly-fetchers.js";

type Call = { sql: string; params: unknown[] };

function scriptedPool(route: (sql: string) => unknown[] = () => []) {
  const calls: Call[] = [];

  return {
    calls,
    query: async <T>(
      sql: string,
      params: unknown[] = [],
    ): Promise<{ rows: T[] }> => {
      calls.push({ sql, params });

      return { rows: route(sql) as T[] };
    },
  };
}

const hit = (id: string, source: string, rank: number) => ({
  id,
  key: id,
  value: `about ${id}`,
  agent_id: "a1",
  source,
  kw_rank: String(rank),
});

describe("fetchers.episodes", () => {
  it("returns the 2 episode rows when 5 memories and 5 facts outrank them", async () => {
    const pool = scriptedPool((sql) => {
      if (/FROM memory\.memories m/.test(sql)) {
        return [1, 2, 3, 4, 5].map((n) => hit(`m${n}`, "memory", n));
      }

      if (/FROM memory\.facts f/.test(sql)) {
        return [
          ...[1, 2, 3, 4, 5].map((n) => hit(`f${n}`, "fact", n)),
          hit("e1", "episode", 6),
          hit("e2", "episode", 7),
        ];
      }

      return [];
    });

    const res = await fetchers.episodes(pool, "deploy", undefined, "a1");

    expect({
      status: res.status,
      paths: res.sources.map((s) => s.source_path),
    }).toEqual({ status: "ok", paths: ["e1", "e2"] });
  });
});

describe("fetchers.graph", () => {
  it("queries the graph for 'settings' and 'lore-api' from 'Add the new settings update for lore-api', not for 'update'", async () => {
    const pool = scriptedPool();

    await fetchers.graph(
      pool,
      "Add the new settings update for lore-api",
      "re-cinq/lore",
    );

    expect(pool.calls.map((c) => c.params[0])).toEqual([
      "settings",
      "lore-api",
    ]);
  });
});
