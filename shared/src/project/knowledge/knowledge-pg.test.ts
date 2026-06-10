import { describe, it, expect } from "vitest";
import { PgKnowledge } from "./knowledge-pg.js";
import type { PgPool } from "../../memory-store.js";

/**
 * PgKnowledge graph + spec reads against a fake PgPool that records SQL/params
 * (the memory-store fake-pool style). Proves repo binding and team-schema
 * resolution without a live database.
 */

function fakePool(capture: Array<{ text: string; params?: unknown[] }>, byCall: unknown[][]): PgPool {
  let call = 0;
  return {
    query: async (text: string, params?: unknown[]) => {
      capture.push({ text, params });
      return { rows: byCall[call++] ?? [] };
    },
  };
}

describe("PgKnowledge", () => {
  it("queries the live graph bound to the repo and maps to GraphEdge", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const pg = new PgKnowledge(
      fakePool(capture, [[{ entity: "lore", entity_type: "service", relation: "uses", related_entity: "pgvector", related_type: "tech", direction: "outgoing", valid_from: "t" }]]),
    );

    const edges = await pg.queryLiveGraph("re-cinq/lore");

    // Delegates to the shared queryLiveGraph (no-entity branch → [relationType||null, repo||null]).
    expect(capture[0].params).toEqual([null, "re-cinq/lore"]);
    expect(edges).toEqual([
      { entity: "lore", entity_type: "service", relation: "uses", related_entity: "pgvector", related_type: "tech", direction: "outgoing", valid_from: "t" },
    ]);
  });

  it("resolves the team schema then lists specs from its chunks", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const pg = new PgKnowledge(
      fakePool(capture, [[{ team: "platform" }], [{ file_path: "specs/x/spec.md" }]]),
    );

    const specs = await pg.listSpecs("re-cinq/lore");

    expect(capture[0].text).toContain("SELECT team FROM lore.repos");
    expect(capture[1].text).toContain("FROM platform.chunks");
    expect(specs).toEqual([{ path: "specs/x/spec.md", title: "specs/x/spec.md" }]);
  });

  it("falls back to org_shared when the team is not a valid schema", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const pg = new PgKnowledge(fakePool(capture, [[{ team: null }], []]));

    await pg.listAdrs("re-cinq/lore");

    expect(capture[1].text).toContain("FROM org_shared.chunks");
  });

  it("assembles repo context through the relocated engine, bound to the repo", async () => {
    const sqlKeyedPool: PgPool = {
      query: async (text: string) => {
        if (text.includes("content_type IN ('doc', 'spec')")) {
          return { rows: [{ content: "CLAUDE.md conventions", file_path: "CLAUDE.md", content_type: "doc" }] };
        }
        return { rows: [] };
      },
    };
    const pg = new PgKnowledge(sqlKeyedPool);

    const result = await pg.assembleContext("re-cinq/lore", "how do conventions work");

    expect(result.text).toContain("CLAUDE.md conventions");
  });
});
