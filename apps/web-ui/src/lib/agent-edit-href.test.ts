import { describe, it, expect } from "vitest";
import { agentEditHrefs } from "./agent-edit-href";
import type { AssemblyLineDefinition } from "./assembly-line-definition";

const definition: AssemblyLineDefinition = {
  name: "implementation-loop",
  description: "tdd",
  version: 1,
  entry: "tdd-round",
  exit: "done",
  nodes: [
    { id: "tdd-round", type: "agent", prompt_ref: "tdd-round" },
    { id: "review-step", type: "agent", prompt_ref: "ready-for-review" },
    { id: "mystery", type: "agent", prompt_ref: "not-in-catalog" },
    { id: "validate", type: "validate" },
  ],
  edges: [],
};

const defs = [
  { name: "tdd-round", project_id: "2263bc7a-0767-42ef-80f0-fc6bc5dea98c" },
  { name: "ready-for-review", project_id: null },
];

describe("agentEditHrefs", () => {
  it("links a repo-overridden recipe to the repo's agent editor and an org default to the global one", () => {
    expect(agentEditHrefs(definition, defs, "re-cinq/lore")).toEqual({
      "tdd-round": "/repos/re-cinq/lore/agents/tdd-round/edit",
      "review-step": "/agents/edit/ready-for-review",
    });
  });

  it("skips non-agent nodes and recipes the catalog does not hold", () => {
    const hrefs = agentEditHrefs(definition, defs, "re-cinq/lore");

    expect(hrefs.validate).toBeUndefined();
    expect(hrefs.mystery).toBeUndefined();
  });

  it("falls back to the node id when an agent node names no prompt_ref", () => {
    const bare: AssemblyLineDefinition = {
      ...definition,
      nodes: [{ id: "ready-for-review", type: "agent" }],
    };

    expect(agentEditHrefs(bare, defs, "re-cinq/lore")).toEqual({
      "ready-for-review": "/agents/edit/ready-for-review",
    });
  });

  it("returns nothing for a run with no definition graph", () => {
    expect(agentEditHrefs(null, defs, "re-cinq/lore")).toEqual({});
  });
});
