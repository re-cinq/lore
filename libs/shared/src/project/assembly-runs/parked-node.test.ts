import { describe, it, expect } from "vitest";
import { parkedNode, parkedHumanNode } from "./parked-node.js";
import type { RunGraph } from "./run-graph.js";

const node = (nodeId: string, iteration: number, outcome: string | null) => ({
  nodeId,
  iteration,
  outcome,
});

const graphWith = (...typedNodes: Array<[id: string, type: string]>): RunGraph => ({
  name: "feature-planning",
  entry: typedNodes[0][0],
  exit: typedNodes[typedNodes.length - 1][0],
  nodes: typedNodes.map(([id, type]) => ({
    id,
    type,
    station: null,
    station_inherited: false,
  })),
  edges: [],
});

describe("parkedNode", () => {
  it("finds the waiting row for the node it was asked about", () => {
    expect(
      parkedNode(
        "running",
        [node("analyze", 1, "success"), node("author", 1, null)],
        "author",
      ),
    ).toEqual({ nodeId: "author", iteration: 1, outcome: null });
  });

  it("ignores a row that already reported an outcome", () => {
    // Reporting twice would either be dropped or, worse, advance a walk that has
    // already moved on.
    expect(
      parkedNode("running", [node("author", 1, "success")], "author"),
    ).toBeNull();
  });

  it("ignores a waiting row for a different node", () => {
    // The same line parks twice — once on the author, once on the spec PR merge —
    // so a bare "is anything waiting" test would report the wrong one.
    expect(
      parkedNode("running", [node("author", 2, null)], "merged"),
    ).toBeNull();
  });

  it("finds the merged node a pushed line is parked on", () => {
    expect(
      parkedNode(
        "running",
        [node("push", 1, "success"), node("merged", 1, null)],
        "merged",
      ),
    ).toEqual({ nodeId: "merged", iteration: 1, outcome: null });
  });

  it("takes the newest waiting row when the node was revisited", () => {
    // A revisit mints a new (nodeId, iteration) row; the open one is the current
    // park, and an older open row would resume a walk that already passed it.
    expect(
      parkedNode(
        "running",
        [node("author", 1, null), node("author", 2, null)],
        "author",
      ),
    ).toMatchObject({ iteration: 2 });
  });

  it("reports nothing for a line that is no longer open", () => {
    for (const status of ["finished", "failed", "cancelled", null]) {
      expect(
        parkedNode(status, [node("merged", 1, null)], "merged"),
      ).toBeNull();
    }
  });

  it("treats a queued line as open", () => {
    // A line can be parked before the walk has been driven once.
    expect(
      parkedNode("queued", [node("author", 1, null)], "author"),
    ).toMatchObject({ nodeId: "author" });
  });
});

describe("parkedHumanNode", () => {
  it("locates the parked row by the graph node's TYPE, not its id", () => {
    // The blueprint may name its wait node anything; the run's own graph carries
    // the type, so a renamed node keeps resuming (the pr_merged join died of
    // exactly this — FR6.32).
    expect(
      parkedHumanNode(
        "running",
        [node("await-spec-merge", 1, null)],
        graphWith(["push", "github_action"], ["await-spec-merge", "pr_review"]),
        "pr_review",
        "merged",
      ),
    ).toEqual({ nodeId: "await-spec-merge", iteration: 1, outcome: null });
  });

  it("falls back to the given node id for a run stamped before clones existed", () => {
    expect(
      parkedHumanNode("running", [node("merged", 1, null)], null, "pr_review", "merged"),
    ).toEqual({ nodeId: "merged", iteration: 1, outcome: null });
  });

  it("passes over a line parked on the OTHER human station type", () => {
    expect(
      parkedHumanNode(
        "running",
        [node("author", 1, null)],
        graphWith(["author", "feature_review"], ["merged", "pr_review"]),
        "pr_review",
        "merged",
      ),
    ).toBeNull();
  });

  it("takes the newest open row when two graph nodes share the type", () => {
    expect(
      parkedHumanNode(
        "running",
        [node("first-review", 1, null), node("second-review", 1, null)],
        graphWith(["first-review", "pr_review"], ["second-review", "pr_review"]),
        "pr_review",
        "merged",
      ),
    ).toMatchObject({ nodeId: "second-review" });
  });
});
