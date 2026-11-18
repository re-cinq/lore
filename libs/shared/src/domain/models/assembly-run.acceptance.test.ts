import { describe, it, expect } from "vitest";
import { AssemblyRunSchema } from "./assembly-run.js";

describe("AssemblyRunSchema", () => {
  it("declares a strict schema for the graph field", () => {
    const invalidRun = {
      id: "run-1",
      blueprintName: "my-blueprint",
      taskId: null,
      repo: "owner/repo",
      branch: null,
      subjectKey: null,
      args: {},
      status: "queued",
      outcome: null,
      reason: null,
      blueprintHash: null,
      resumedFromRunId: null,
      resumedFromNodeId: null,
      inheritedNodeCount: 0,
      createdAt: new Date("2026-11-16T12:00:00Z"),
      startedAt: null,
      finishedAt: null,
      graph: {
        entry: "start",
        exit: "end",
        nodes: [],
        edges: [],
      },
    };

    const result = AssemblyRunSchema.safeParse(invalidRun);

    expect(result.success).toBe(false);
  });
});
