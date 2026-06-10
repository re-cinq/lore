import { describe, it, expect } from "vitest";
import { KnowledgeView } from "./knowledge.js";
import type { KnowledgePort } from "./knowledge-port.js";

/**
 * project.knowledge binds the repo across the spec/ADR/graph reads. The fake
 * echoes the repo it was called with so we prove the binding.
 */

function fakeKnowledge(): KnowledgePort {
  return {
    assembleContext: async (repo, query) => ({ text: `[${repo}] ${query}` }),
    queryLiveGraph: async (repo) => [
      {
        entity: repo,
        entity_type: "service",
        relation: "uses",
        related_entity: "pgvector",
        related_type: "technology",
        direction: "outgoing",
        valid_from: "t",
      },
    ],
    queryTrace: async () => "trace not yet available",
    listSpecs: async (repo) => (repo === "re-cinq/lore" ? [{ path: "specs/x/spec.md", title: "X" }] : []),
    listAdrs: async () => [],
  };
}

describe("KnowledgeView", () => {
  it("assembles context scoped to the repo", async () => {
    const facade = new KnowledgeView("re-cinq/lore", fakeKnowledge());

    expect(await facade.assembleContext("how does auth work")).toEqual({
      text: "[re-cinq/lore] how does auth work",
    });
  });

  it("lists the repo's specs", async () => {
    const facade = new KnowledgeView("re-cinq/lore", fakeKnowledge());

    expect(await facade.listSpecs()).toEqual([{ path: "specs/x/spec.md", title: "X" }]);
  });
});
