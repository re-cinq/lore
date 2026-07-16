import { describe, it, expect } from "vitest";
import { projectDocsIntoGraph } from "./reindex.js";
import type { DgraphClientPort } from "@re-cinq/lore-shared";

/**
 * projectDocsIntoGraph is the reindex job's spec-traceability backstop: it
 * projects specs + ADRs into the graph so a CI graph job that soft-skipped
 * (LORE_WEBHOOK_URL unset) self-heals nightly. Exercised with an empty-tree
 * reader (no graph writes) and a stub dgraph — no live Dgraph. The reader's
 * tree() call count proves how many kinds ran (projectRepoGraph lists the tree
 * once per kind).
 */
const stubDgraph = {} as DgraphClientPort;

function fakeReader() {
  const treeCalls: (string | undefined)[] = [];

  return {
    treeCalls,
    reader: {
      tree: async (ref?: string) => {
        treeCalls.push(ref);

        return [] as string[];
      },
      read: async () => "" as string | null,
    },
  };
}

describe("projectDocsIntoGraph", () => {
  it("projects both specs and adrs when a dgraph client is configured", async () => {
    const f = fakeReader();

    await projectDocsIntoGraph("re-cinq/lore", stubDgraph, f.reader);

    expect(f.treeCalls).toHaveLength(2);
  });

  it("no-ops without reading the repo when dgraph is unconfigured", async () => {
    const f = fakeReader();

    await projectDocsIntoGraph("re-cinq/lore", null, f.reader);

    expect(f.treeCalls).toEqual([]);
  });

  it("isolates a failing kind so the other still projects", async () => {
    let attempts = 0;
    const reader = {
      tree: async () => {
        attempts += 1;
        throw new Error("boom");
      },
      read: async () => "" as string | null,
    };

    await expect(
      projectDocsIntoGraph("re-cinq/lore", stubDgraph, reader),
    ).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });
});
