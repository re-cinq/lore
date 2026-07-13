import { describe, it, expect, vi } from "vitest";

// No Vertex creds in tests → keyword-only retrieval path (deterministic, no net).
vi.mock("../../embeddings/embedding-service.js", () => ({
  getQueryEmbedding: async () => null,
}));

import { PgKnowledge } from "./knowledge-pg.js";
import type { PgPool } from "../../memory-store.js";

/**
 * PgKnowledge graph + spec reads against a fake PgPool that records SQL/params
 * (the memory-store fake-pool style). Proves repo binding and team-schema
 * resolution without a live database.
 */

function fakePool(
  capture: Array<{ text: string; params?: unknown[] }>,
  byCall: unknown[][],
): PgPool {
  let call = 0;

  return {
    query: async <T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> => {
      capture.push({ text, params });

      return { rows: (byCall[call++] ?? []) as T[] };
    },
  };
}

describe("PgKnowledge", () => {
  it("queries the live graph bound to the repo and maps to GraphEdge", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const pg = new PgKnowledge(
      fakePool(capture, [
        [
          {
            entity: "lore",
            entity_type: "service",
            relation: "uses",
            related_entity: "pgvector",
            related_type: "tech",
            direction: "outgoing",
            valid_from: "t",
          },
        ],
      ]),
    );

    const edges = await pg.queryLiveGraph("re-cinq/lore");

    // Delegates to the shared queryLiveGraph (no-entity branch → [relationType||null, repo||null]).
    expect(capture[0].params).toEqual([null, "re-cinq/lore"]);
    expect(edges).toEqual([
      {
        entity: "lore",
        entity_type: "service",
        relation: "uses",
        related_entity: "pgvector",
        related_type: "tech",
        direction: "outgoing",
        valid_from: "t",
      },
    ]);
  });

  it("resolves the team schema then lists specs from its chunks", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const pg = new PgKnowledge(
      fakePool(capture, [
        [{ team: "platform" }],
        [{ file_path: "specs/x/spec.md" }],
      ]),
    );

    const specs = await pg.listSpecs("re-cinq/lore");

    expect(capture[0].text).toContain("SELECT team FROM lore.repos");
    expect(capture[1].text).toContain("FROM platform.chunks");
    expect(specs).toEqual([
      { path: "specs/x/spec.md", title: "specs/x/spec.md" },
    ]);
  });

  it("falls back to org_shared when the team is not a valid schema", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const pg = new PgKnowledge(fakePool(capture, [[{ team: null }], []]));

    await pg.listAdrs("re-cinq/lore");

    expect(capture[1].text).toContain("FROM org_shared.chunks");
  });

  it("assembles repo context through the relocated engine, bound to the repo", async () => {
    const sqlKeyedPool: PgPool = {
      query: async <T>(text: string): Promise<{ rows: T[] }> => {
        if (text.includes("content_type = ANY")) {
          return {
            rows: [
              {
                content: "CLAUDE.md conventions",
                file_path: "CLAUDE.md",
                content_type: "doc",
              },
            ] as T[],
          };
        }

        return { rows: ([]) as T[] };
      },
    };
    const pg = new PgKnowledge(sqlKeyedPool);

    const result = await pg.assembleContext(
      "re-cinq/lore",
      "how do conventions work",
    );

    expect(result.text).toContain("CLAUDE.md conventions");
  });
});
