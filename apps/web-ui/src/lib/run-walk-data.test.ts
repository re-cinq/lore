import { describe, it, expect } from "vitest";
import { walkRunData } from "./run-walk-data";
import type { AssemblyRunNode } from "./assembly-runs";
import type { AssemblyLineDefinition } from "./assembly-line-definition";

const definition: AssemblyLineDefinition = {
  name: "feature-planning",
  description: "plan then write",
  version: 1,
  entry: "analyze",
  exit: "done",
  nodes: [
    { id: "analyze", type: "agent" },
    { id: "write", type: "agent" },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "analyze", to: "write", on: "success" },
    { from: "write", to: "done", on: "success" },
    { from: "write", to: "analyze", on: "changes_requested" },
  ],
};

const row = (over: Partial<AssemblyRunNode> = {}): AssemblyRunNode => ({
  nodeId: "analyze",
  iteration: 1,
  outcome: null,
  agentCrName: null,
  commitSha: null,
  durationSeconds: null,
  ...over,
});

describe("walkRunData", () => {
  it("reads a closed row as its outcome and an open one as running", () => {
    const walk = walkRunData(
      definition,
      [row({ outcome: "success" }), row({ nodeId: "write" })],
      false,
    );

    expect(walk.statuses).toEqual({ analyze: "succeeded", write: "running" });
    expect(walk.verdicts).toEqual({ analyze: "success", write: null });
  });

  it("takes the newest iteration of a node the walk came back to", () => {
    const walk = walkRunData(
      definition,
      [
        row({ outcome: "changes_requested", iteration: 1 }),
        row({ outcome: "success", iteration: 2 }),
      ],
      false,
    );

    expect(walk.verdicts.analyze).toBe("success");
  });

  it("marks the edge a closed row's outcome routed along as taken", () => {
    const walk = walkRunData(definition, [row({ outcome: "success" })], false);

    expect([...walk.taken]).toEqual(["analyze-write-success"]);
  });

  it("results completed on a finished run and failed on any failed outcome", () => {
    const rows = [row({ outcome: "success" })];

    expect(walkRunData(definition, rows, true).result).toBe("completed");
    expect(walkRunData(definition, rows, false).result).toBeNull();
    expect(
      walkRunData(definition, [row({ outcome: "write-failed" })], true).result,
    ).toBe("failed");
  });
});
