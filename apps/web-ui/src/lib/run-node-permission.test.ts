import { describe, it, expect } from "vitest";
import { canRunByHand } from "./run-node-permission";
import type { AssemblyLineDefinition } from "./assembly-line-definition";

const definition = {
  name: "planning",
  description: "",
  version: 1,
  entry: "draft",
  exit: "done",
  fail: "failed",
  nodes: [
    { id: "draft", type: "agent" },
    { id: "ground", type: "validate" },
    { id: "approve", type: "pr_review" },
    { id: "done", type: "retrospective" },
    { id: "failed", type: "retrospective" },
  ],
  edges: [],
} as unknown as AssemblyLineDefinition;

describe("canRunByHand", () => {
  it.each([
    ["the draft agent node", "draft", true],
    ["the ground service node", "ground", true],
    ["the approve node, which waits on a person", "approve", false],
    ["the done exit node", "done", false],
    ["the failed node", "failed", false],
  ] as const)("answers %s on a floor run", (_name, nodeId, allowed) => {
    expect(canRunByHand(nodeId, definition, "floor")).toBe(allowed);
  });

  it("refuses every node of a run Lore's own engine walked", () => {
    expect(canRunByHand("draft", definition, "lore")).toBe(false);
  });
});
