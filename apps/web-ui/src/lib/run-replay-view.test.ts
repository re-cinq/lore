import { describe, it, expect } from "vitest";
import { latestRowByNode } from "./run-replay-view";
import type { AssemblyRunNode } from "./assembly-runs";

function row(over: Partial<AssemblyRunNode> = {}): AssemblyRunNode {
  return {
    nodeId: "implement",
    iteration: 1,
    outcome: "success",
    agentCrName: null,
    commitSha: null,
    durationSeconds: null,
    ...over,
  };
}

describe("latestRowByNode", () => {
  it("picks the max iteration per node regardless of row order", () => {
    const ascending = latestRowByNode([
      row({ iteration: 1, outcome: "failed" }),
      row({ iteration: 2, outcome: "success" }),
    ]);
    const descending = latestRowByNode([
      row({ iteration: 2, outcome: "success" }),
      row({ iteration: 1, outcome: "failed" }),
    ]);

    expect(ascending.get("implement")).toMatchObject({
      iteration: 2,
      outcome: "success",
    });
    expect(descending.get("implement")).toEqual(ascending.get("implement"));
  });

  it("keeps one entry per node across several nodes", () => {
    const latest = latestRowByNode([
      row({ nodeId: "implement", iteration: 1 }),
      row({ nodeId: "validate", iteration: 1, outcome: "failed" }),
    ]);

    expect([...latest.keys()].sort()).toEqual(["implement", "validate"]);
  });
});
