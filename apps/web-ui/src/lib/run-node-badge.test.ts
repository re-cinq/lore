import { describe, it, expect } from "vitest";
import type { AssemblyRunNode } from "./assembly-run-rows";
import type { NodeRunState } from "./run-event-reducer";
import { formatNodeMeta, nodeBadgeMeta } from "./run-node-badge";

const row = (over: Partial<AssemblyRunNode> = {}): AssemblyRunNode => ({
  nodeId: "implement",
  iteration: 1,
  outcome: null,
  agentCrName: null,
  commitSha: null,
  durationSeconds: null,
  startedAt: "2026-09-09T10:00:00.000Z",
  ...over,
});

const running: NodeRunState = {
  status: "running",
  iteration: 1,
  transcript: [],
  droppedCount: 0,
};

const now = "2026-09-09T10:03:12.000Z";

describe("nodeBadgeMeta", () => {
  it("counts a running node's duration from its start to now", () => {
    const meta = nodeBadgeMeta({
      row: row(),
      state: running,
      model: { model: "claude-sonnet-4-6", source: "recipe" },
      now,
    });

    expect(meta).toEqual({
      model: "Sonnet 4.6",
      durationSeconds: 192,
      iteration: 1,
    });
  });

  it("reports a finished visit's recorded duration and iteration", () => {
    const meta = nodeBadgeMeta({
      row: row({ iteration: 2, outcome: "success", durationSeconds: 45 }),
      state: { ...running, status: "succeeded", iteration: 2 },
      model: undefined,
      now,
    });

    expect(meta).toEqual({ model: null, durationSeconds: 45, iteration: 2 });
  });

  it("reports no duration for a node that has not run", () => {
    expect(
      nodeBadgeMeta({
        row: undefined,
        state: undefined,
        model: undefined,
        now,
      }),
    ).toEqual({ model: null, durationSeconds: null, iteration: 0 });
  });
});

describe("formatNodeMeta", () => {
  it("joins model, duration and a repeat count with middle dots, showing the count from the second visit", () => {
    expect(
      formatNodeMeta({
        model: "Sonnet 4.6",
        durationSeconds: 192,
        iteration: 2,
      }),
    ).toBe("Sonnet 4.6 · 3m 12s · ×2");
    expect(
      formatNodeMeta({ model: "Sonnet 4.6", durationSeconds: 8, iteration: 1 }),
    ).toBe("Sonnet 4.6 · 8s");
  });

  it("reads as nothing for an unvisited node with no model", () => {
    expect(
      formatNodeMeta({ model: null, durationSeconds: null, iteration: 0 }),
    ).toBe("");
  });
});
