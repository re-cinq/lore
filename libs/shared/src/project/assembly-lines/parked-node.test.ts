import { describe, it, expect } from "vitest";
import { parkedNode } from "./parked-node.js";

const node = (nodeId: string, iteration: number, outcome: string | null) => ({
  nodeId,
  iteration,
  outcome,
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
      expect(parkedNode(status, [node("merged", 1, null)], "merged")).toBeNull();
    }
  });

  it("treats a queued line as open", () => {
    // A line can be parked before the walk has been driven once.
    expect(
      parkedNode("queued", [node("author", 1, null)], "author"),
    ).toMatchObject({ nodeId: "author" });
  });
});
