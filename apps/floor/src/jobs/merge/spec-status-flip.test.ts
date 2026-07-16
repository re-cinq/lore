import { describe, it, expect } from "vitest";
import { decideSpecStatusFlip } from "./merge-check.js";

type GateTask = Parameters<typeof decideSpecStatusFlip>[0];

const task = (over: Partial<GateTask> = {}): GateTask => ({
  task_type: "spec-task",
  task_group_id: "g1",
  context_bundle: { feature_id: "f1" },
  ...over,
});

describe("decideSpecStatusFlip", () => {
  it("returns the feature id when the last spec-task in a group merges", () => {
    expect(decideSpecStatusFlip(task(), 0)).toEqual({ featureId: "f1" });
  });

  it("returns null while siblings in the group are still unmerged", () => {
    expect(decideSpecStatusFlip(task(), 2)).toBeNull();
  });

  it("returns null for a non-spec-task type", () => {
    expect(decideSpecStatusFlip(task({ task_type: "general" }), 0)).toBeNull();
  });

  it("returns null for a task with no group", () => {
    expect(decideSpecStatusFlip(task({ task_group_id: null }), 0)).toBeNull();
  });

  it("returns null when the bundle carries no feature id", () => {
    expect(decideSpecStatusFlip(task({ context_bundle: {} }), 0)).toBeNull();
    expect(decideSpecStatusFlip(task({ context_bundle: null }), 0)).toBeNull();
  });
});
