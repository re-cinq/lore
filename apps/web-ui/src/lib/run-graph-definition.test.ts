import { describe, it, expect } from "vitest";
import { definitionForRun } from "./run-graph-definition";
import type { AssemblyLineRunNode } from "./assembly-line-runs";
import type { RunGraph } from "./run-graph";

const storedGraph: RunGraph = {
  name: "code-review",
  entry: "review",
  exit: "done",
  nodes: [
    { id: "review", type: "agent", station: "code-review" },
    { id: "done", type: "retrospective", station: "def-retrospective" },
  ],
  edges: [{ from: "review", to: "done", on: "success" }],
};

const row = (
  nodeId: string,
  over: Partial<AssemblyLineRunNode> = {},
): AssemblyLineRunNode => ({
  nodeId,
  iteration: 1,
  outcome: "success",
  agentCrName: null,
  commitSha: null,
  durationSeconds: null,
  ...over,
});

describe("definitionForRun on a run carrying its own graph", () => {
  it("draws the graph the run RECORDED, not a transcription of today's yaml", () => {
    // The whole point of the clone: a blueprint edited or renamed after the run
    // must not change what that run is shown to have walked.
    const { definition, synthetic } = definitionForRun(
      "code-review",
      [row("review")],
      storedGraph,
    );

    expect(synthetic).toBe(false);
    expect(definition?.entry).toBe("review");
    expect(definition?.nodes.map((n) => n.id)).toEqual(["review", "done"]);
    expect(definition?.edges).toEqual([
      { from: "review", to: "done", on: "success" },
    ]);
  });

  it("falls back to the inferred chain for a run stamped before clones existed", () => {
    // Those rows carry no graph and are not recoverable — the blueprint a
    // historical run used is not derivable from the row. An inferred chain of the
    // nodes it actually visited beats showing nothing.
    const { definition, synthetic } = definitionForRun("code-review", [
      row("review"),
      row("done"),
    ]);

    expect(synthetic).toBe(true);
    expect(definition?.nodes.map((n) => n.id)).toEqual(["review", "done"]);
  });
});

describe("definitionForRun", () => {
  it("returns synthetic true for an unknown definition name with visit rows", () => {
    expect(definitionForRun("bespoke", [row("draft")])).toMatchObject({
      synthetic: true,
      definition: { name: "bespoke", entry: "draft", exit: "draft" },
    });
  });

  it("returns distinct node ids in visit order for repeated rows of the same node", () => {
    const { definition } = definitionForRun("bespoke", [
      row("draft"),
      row("validate"),
      row("draft", { iteration: 2 }),
      row("push"),
    ]);

    expect(definition?.nodes).toEqual([
      { id: "draft", type: "agent" },
      { id: "validate", type: "agent" },
      { id: "push", type: "agent" },
    ]);
  });

  it("joins synthesized nodes with sequential always edges", () => {
    const { definition } = definitionForRun("bespoke", [
      row("draft"),
      row("validate"),
      row("push"),
    ]);

    expect(definition?.edges).toEqual([
      { from: "draft", to: "validate", on: "always" },
      { from: "validate", to: "push", on: "always" },
    ]);
  });

  it("returns a null definition for an unknown name with zero visit rows", () => {
    expect(definitionForRun("bespoke", [])).toEqual({
      definition: null,
      synthetic: true,
    });
  });
});
