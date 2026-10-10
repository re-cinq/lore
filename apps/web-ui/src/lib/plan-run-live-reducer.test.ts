import { describe, it, expect } from "vitest";
import {
  initialPlanRunLive,
  reducePlanRunLive,
  type PlanRunLiveState,
} from "./plan-run-live-reducer";
import type { NodeStatusFrame, RunStatusFrame } from "./run-stream-types";

const seed: PlanRunLiveState = initialPlanRunLive(
  { status: "running", outcome: null, reason: null },
  [],
);

function nodeStatus(
  overrides: Partial<NodeStatusFrame["node"]>,
): NodeStatusFrame {
  return {
    type: "node_status",
    node: {
      node_id: "author",
      iteration: 0,
      outcome: null,
      agent_cr_name: null,
      station_run_id: null,
      input: null,
      commit_sha: null,
      started_at: "2026-10-08T10:00:00.000Z",
      finished_at: null,
      status: "running",
      claimed_at: null,
      ...overrides,
    },
  } as NodeStatusFrame;
}

function runStatus(overrides: Partial<RunStatusFrame["run"]>): RunStatusFrame {
  return {
    type: "run_status",
    run: {
      status: "running",
      outcome: null,
      reason: null,
      started_at: null,
      finished_at: null,
      ...overrides,
    },
  } as RunStatusFrame;
}

describe("reducePlanRunLive", () => {
  it("appends a new visit from a node_status frame for author iteration 0", () => {
    const next = reducePlanRunLive(seed, nodeStatus({}));

    expect(next.nodes).toMatchObject([{ nodeId: "author", iteration: 0 }]);
  });

  it("replaces the same visit in place when author iteration 0 settles with outcome changes_requested", () => {
    const opened = reducePlanRunLive(seed, nodeStatus({}));
    const settled = reducePlanRunLive(
      opened,
      nodeStatus({ outcome: "changes_requested" }),
    );

    expect(settled.nodes).toMatchObject([
      { nodeId: "author", iteration: 0, outcome: "changes_requested" },
    ]);
  });

  it("updates run status and outcome from a run_status frame reporting finished/completed", () => {
    const next = reducePlanRunLive(
      seed,
      runStatus({ status: "finished", outcome: "completed" }),
    );

    expect(next.run).toEqual({
      status: "finished",
      outcome: "completed",
      reason: null,
    });
  });

  it("leaves state unchanged for an agent_event frame", () => {
    const frame = { type: "agent_event" } as never;

    expect(reducePlanRunLive(seed, frame)).toBe(seed);
  });

  it("replaces the whole fold with a reset action's run and nodes, dropping what was folded before it", () => {
    const folded = reducePlanRunLive(seed, nodeStatus({}));
    const reset = reducePlanRunLive(folded, {
      type: "reset",
      run: { status: "finished", outcome: "completed", reason: null },
      nodes: [],
    });

    expect(reset).toEqual({
      run: { status: "finished", outcome: "completed", reason: null },
      nodes: [],
    });
  });
});
