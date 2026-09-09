import { describe, it, expect } from "vitest";
import type { PgPool } from "@re-cinq/lore-shared";
import { extractAndUpdateGraph } from "./graph.js";

interface QueryCall {
  text: string;
  params?: unknown[];
}

function scriptedPool(
  respond: (text: string, params?: unknown[]) => { rows: unknown[] },
): { pool: PgPool; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const pool: PgPool = {
    async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
      calls.push({ text, params });

      return respond(text, params) as { rows: T[] };
    },
  };

  return { pool, calls };
}

function entityId(name: unknown): string {
  return name === "auth-service" ? "id-auth" : "id-hono";
}

const CONTRADICTORY_EDGE = JSON.stringify({
  entities: [
    { name: "auth-service", type: "service" },
    { name: "hono", type: "technology" },
  ],
  edges: [{ source: "auth-service", target: "hono", relation: "uses" }],
});

const llmCall = async (): Promise<string> => CONTRADICTORY_EDGE;

describe("extractAndUpdateGraph edge invalidation", () => {
  it("invalidates the different-target edge then inserts when source+relation collide", async () => {
    const { pool, calls } = scriptedPool((text, params) => {
      if (text.includes("INSERT INTO memory.entities")) {
        return { rows: [{ id: entityId(params?.[0]) }] };
      }

      if (text.includes("SELECT id FROM memory.edges")) {
        return { rows: [] };
      }

      return { rows: [] };
    });

    await extractAndUpdateGraph(
      pool,
      "text",
      { repo: "octo/repo", sourceEpisodeId: "ep-1", sourceMemoryId: "mem-1" },
      llmCall,
    );

    const invalidate = calls.find((c) =>
      c.text.includes("UPDATE memory.edges"),
    );
    const insert = calls.find((c) =>
      c.text.includes("INSERT INTO memory.edges"),
    );
    const invalidateIndex = calls.findIndex((c) =>
      c.text.includes("UPDATE memory.edges"),
    );
    const insertIndex = calls.findIndex((c) =>
      c.text.includes("INSERT INTO memory.edges"),
    );

    expect(invalidate?.text).toContain("SET valid_to = now()");
    expect(invalidate?.text).toContain("target_id != $3");
    expect(invalidate?.params).toEqual(["id-auth", "uses", "id-hono"]);
    expect(insert?.params).toEqual([
      "id-auth",
      "id-hono",
      "uses",
      "ep-1",
      "mem-1",
    ]);
    expect(invalidateIndex).toBeLessThan(insertIndex);
  });

  it("issues no invalidation or insert when the exact edge already exists", async () => {
    const { pool, calls } = scriptedPool((text, params) => {
      if (text.includes("INSERT INTO memory.entities")) {
        return { rows: [{ id: entityId(params?.[0]) }] };
      }

      if (text.includes("SELECT id FROM memory.edges")) {
        return { rows: [{ id: "existing-edge" }] };
      }

      return { rows: [] };
    });

    await extractAndUpdateGraph(
      pool,
      "text",
      { repo: "octo/repo", sourceEpisodeId: "ep-1", sourceMemoryId: "mem-1" },
      llmCall,
    );

    expect(calls.some((c) => c.text.includes("UPDATE memory.edges"))).toBe(
      false,
    );
    expect(calls.some((c) => c.text.includes("INSERT INTO memory.edges"))).toBe(
      false,
    );
  });
});

describe("extractAndUpdateGraph failure isolation", () => {
  it("skips a failed entity upsert and any edge depending on it, keeping the rest", async () => {
    const raw = JSON.stringify({
      entities: [
        { name: "auth-service", type: "service" },
        { name: "broken-entity", type: "service" },
      ],
      edges: [
        { source: "auth-service", target: "broken-entity", relation: "uses" },
      ],
    });
    const llmCall = async (): Promise<string> => raw;
    const edgeQueries: string[] = [];

    const pool: PgPool = {
      async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
        const isBrokenEntityInsert =
          text.includes("INSERT INTO memory.entities") &&
          params?.[0] === "broken-entity";

        if (isBrokenEntityInsert) {
          return Promise.reject(new Error("db down"));
        }

        if (text.includes("INSERT INTO memory.entities")) {
          return { rows: [{ id: "id-auth" }] as T[] };
        }

        if (text.includes("memory.edges")) {
          edgeQueries.push(text);
        }

        return { rows: [] as T[] };
      },
    };

    await expect(
      extractAndUpdateGraph(
        pool,
        "text",
        { repo: null, sourceEpisodeId: null, sourceMemoryId: null },
        llmCall,
      ),
    ).resolves.toBeUndefined();

    expect(edgeQueries).toHaveLength(0);
  });

  it("continues upserting edges after one edge upsert fails", async () => {
    const raw = JSON.stringify({
      entities: [
        { name: "a", type: "service" },
        { name: "b", type: "service" },
        { name: "c", type: "service" },
      ],
      edges: [
        { source: "a", target: "b", relation: "uses" },
        { source: "b", target: "c", relation: "uses" },
      ],
    });
    const llmCall = async (): Promise<string> => raw;
    const idFor: Record<string, string> = { a: "id-a", b: "id-b", c: "id-c" };
    const edgeInserts: unknown[][] = [];

    const recordEdgeInsert = <T>(
      params: unknown[] | undefined,
    ): Promise<{ rows: T[] }> => {
      edgeInserts.push(params ?? []);

      return params?.[0] === "id-a"
        ? Promise.reject(new Error("insert failed"))
        : Promise.resolve({ rows: [] as T[] });
    };

    const pool: PgPool = {
      async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
        if (text.includes("INSERT INTO memory.entities")) {
          return { rows: [{ id: idFor[params?.[0] as string] }] as T[] };
        }

        return text.includes("INSERT INTO memory.edges")
          ? recordEdgeInsert<T>(params)
          : { rows: [] as T[] };
      },
    };

    await expect(
      extractAndUpdateGraph(
        pool,
        "text",
        { repo: null, sourceEpisodeId: null, sourceMemoryId: null },
        llmCall,
      ),
    ).resolves.toBeUndefined();

    expect(edgeInserts).toHaveLength(2);
  });
});
