import { describe, it, expect } from "vitest";
import type { AssemblyRun } from "./assembly-runs";
import {
  initialRunLive,
  reduceRunLive,
  withLiveFacts,
  type RunLiveState,
} from "./run-live-reducer";
import type { NodeStatusFrame } from "./run-stream-types";

const run: AssemblyRun = {
  id: "run-1",
  blueprintName: "implementation",
  graph: null,
  taskId: "task-1",
  repo: "o/r",
  branch: "feat/x",
  status: "running",
  outcome: null,
  reason: null,
  createdAt: "2026-09-09T10:00:00.000Z",
  startedAt: "2026-09-09T10:00:05.000Z",
  durationSeconds: null,
  prUrl: null,
  prNumber: 12,
  createdBy: null,
  costUsd: null,
};

function nodeFrame(
  over: Partial<NodeStatusFrame["node"]> = {},
): NodeStatusFrame {
  return {
    type: "node_status",
    node: {
      node_id: "implement",
      iteration: 1,
      outcome: null,
      agent_cr_name: "05fc-implement",
      station_run_id: "sr-1",
      input: null,
      commit_sha: null,
      started_at: "2026-09-09T10:00:10.000Z",
      finished_at: null,
      status: "running",
      claimed_at: null,
      ...over,
    },
  };
}

function seeded(): RunLiveState {
  return initialRunLive(run, [], []);
}

describe("initialRunLive", () => {
  it("seeds the run facts, visit rows and task events from the server render with no CI check", () => {
    expect(seeded()).toEqual({
      run: {
        status: "running",
        outcome: null,
        reason: null,
        startedAt: "2026-09-09T10:00:05.000Z",
        finishedAt: null,
      },
      nodes: [],
      taskEvents: [],
      ciCheck: null,
    });
  });

  it("reconstructs a finished run's end from its start and duration", () => {
    const state = initialRunLive(
      { ...run, status: "finished", durationSeconds: 120 },
      [],
      [],
    );

    expect(state.run.finishedAt).toBe("2026-09-09T10:02:05.000Z");
  });
});

describe("reduceRunLive node_status", () => {
  it("appends a visit row it has not seen and maps the wire row to the page's node shape", () => {
    const state = reduceRunLive(seeded(), nodeFrame());

    expect(state.nodes).toEqual([
      {
        nodeId: "implement",
        iteration: 1,
        outcome: null,
        agentCrName: "05fc-implement",
        input: null,
        commitSha: null,
        durationSeconds: null,
        startedAt: "2026-09-09T10:00:10.000Z",
      },
    ]);
  });

  it("replaces the row with the same node and iteration in place, keeping visit order", () => {
    const twoVisits = reduceRunLive(
      reduceRunLive(seeded(), nodeFrame()),
      nodeFrame({ node_id: "validate" }),
    );
    const finished = reduceRunLive(
      twoVisits,
      nodeFrame({
        outcome: "success",
        finished_at: "2026-09-09T10:03:10.000Z",
      }),
    );

    expect(finished.nodes.map((n) => [n.nodeId, n.outcome])).toEqual([
      ["implement", "success"],
      ["validate", null],
    ]);
    expect(finished.nodes[0].durationSeconds).toBe(180);
  });

  it("keeps two iterations of one node as two rows", () => {
    const state = reduceRunLive(
      reduceRunLive(seeded(), nodeFrame()),
      nodeFrame({ iteration: 2 }),
    );

    expect(state.nodes.map((n) => n.iteration)).toEqual([1, 2]);
  });
});

describe("reduceRunLive run_status, task_event and ci_check", () => {
  it("replaces the run facts on a run_status frame", () => {
    const state = reduceRunLive(seeded(), {
      type: "run_status",
      run: {
        id: "run-1",
        status: "finished",
        outcome: "success",
        reason: null,
        started_at: "2026-09-09T10:00:05.000Z",
        finished_at: "2026-09-09T10:05:05.000Z",
      },
    });

    expect(state.run).toEqual({
      status: "finished",
      outcome: "success",
      reason: null,
      startedAt: "2026-09-09T10:00:05.000Z",
      finishedAt: "2026-09-09T10:05:05.000Z",
    });
  });

  it("upserts a task event by id so a re-sent snapshot adds nothing", () => {
    const event = {
      id: "7",
      task_id: "task-1",
      from_status: "pending",
      to_status: "running",
      metadata: null,
      created_at: "2026-09-09T10:00:06.000Z",
    };
    const once = reduceRunLive(seeded(), { type: "task_event", event });
    const twice = reduceRunLive(once, { type: "task_event", event });

    expect(twice.taskEvents).toEqual([event]);
  });

  it("replaces the CI check whole", () => {
    const state = reduceRunLive(seeded(), {
      type: "ci_check",
      check: {
        repo: "o/r",
        pr_number: 12,
        observed_at: "2026-09-09T10:00:30.000Z",
        status: { computed_status: "checks-failing" },
      },
    });

    expect(state.ciCheck?.status).toEqual({
      computed_status: "checks-failing",
    });
  });

  it("returns the same state object for an agent_event or catchup_complete frame", () => {
    const state = seeded();

    expect(
      reduceRunLive(state, { type: "catchup_complete", last_id: "9" }),
    ).toBe(state);
  });
});

describe("withLiveFacts", () => {
  it("lays the live status, outcome and a recomputed duration over the server run", () => {
    const overlaid = withLiveFacts(run, {
      status: "finished",
      outcome: "success",
      reason: null,
      startedAt: "2026-09-09T10:00:05.000Z",
      finishedAt: "2026-09-09T10:02:05.000Z",
    });

    expect(overlaid).toMatchObject({
      id: "run-1",
      status: "finished",
      outcome: "success",
      durationSeconds: 120,
    });
  });
});
