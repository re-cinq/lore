import { describe, it, expect } from "vitest";
import {
  completedRowsAt,
  latestRowByNode,
  replayRunData,
} from "./run-replay-view";
import type { AssemblyLineRunNode } from "./assembly-line-runs";
import type { NodeRunState } from "./run-event-reducer";
import {
  codeReviewDefinition,
  implementationDefinition,
} from "./builtin-definitions";

function row(over: Partial<AssemblyLineRunNode> = {}): AssemblyLineRunNode {
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

function nodeState(over: Partial<NodeRunState> = {}): NodeRunState {
  return {
    status: "idle",
    iteration: 0,
    transcript: [],
    droppedCount: 0,
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

describe("completedRowsAt", () => {
  it("excludes a row whose node is still running its iteration", () => {
    const rows = [row({ iteration: 1, outcome: "failed" })];
    const states = {
      implement: nodeState({ status: "running", iteration: 1 }),
    };

    expect(completedRowsAt(rows, states)).toEqual([]);
  });

  it("excludes a row whose node has no replayed state or sits idle", () => {
    const rows = [
      row({ nodeId: "implement" }),
      row({ nodeId: "validate", outcome: "failed" }),
    ];
    const states = { validate: nodeState({ status: "idle", iteration: 0 }) };

    expect(completedRowsAt(rows, states)).toEqual([]);
  });

  it("includes a row once its node reaches a terminal status on that iteration", () => {
    const succeeded = row({ iteration: 1, outcome: "success" });
    const failed = row({ nodeId: "validate", iteration: 1, outcome: "failed" });
    const states = {
      implement: nodeState({ status: "succeeded", iteration: 1 }),
      validate: nodeState({ status: "failed", iteration: 1 }),
    };

    expect(completedRowsAt([succeeded, failed], states)).toEqual([
      succeeded,
      failed,
    ]);
  });

  it("includes an older iteration's row while the node runs the next one", () => {
    const first = row({ iteration: 1, outcome: "failed" });
    const second = row({ iteration: 2, outcome: null });
    const states = {
      implement: nodeState({ status: "running", iteration: 2 }),
    };

    expect(completedRowsAt([first, second], states)).toEqual([first]);
  });

  it("excludes a row when the node state is idle at a higher iteration", () => {
    // Reachable: the reducer stamps `iteration` on every event but a
    // non-lifecycle event leaves status idle, so a node whose init never
    // replayed can sit idle past a row's iteration having completed nothing.
    const rows = [row({ iteration: 1, outcome: "failed" })];
    const states = { implement: nodeState({ status: "idle", iteration: 2 }) };

    expect(completedRowsAt(rows, states)).toEqual([]);
  });
});

describe("replayRunData", () => {
  it("holds the verdict null while the node runs, even when an older iteration failed", () => {
    const data = replayRunData(
      implementationDefinition,
      [
        row({ iteration: 1, outcome: "failed" }),
        row({ iteration: 2, outcome: "success" }),
      ],
      { implement: nodeState({ status: "running", iteration: 2 }) },
    );

    expect(data.verdicts).toEqual({});
    expect(data.statuses.implement).toBe("running");
  });

  it("reads the verdict from the walk row, not the result event, once the result applies", () => {
    // The #927 case at a cursor: the review pod exited 0 (replayed status
    // succeeded) but the recorded verdict is failed — the badge source must be
    // the row the moment the node completes at the cursor.
    const data = replayRunData(
      codeReviewDefinition,
      [row({ nodeId: "review", iteration: 1, outcome: "failed" })],
      { review: nodeState({ status: "succeeded", iteration: 1 }) },
    );

    expect(data.verdicts).toEqual({ review: "failed" });
  });

  it("grows the taken path with the cursor, including a retry back-edge", () => {
    const rows = [
      row({ iteration: 1, outcome: "failed" }),
      row({ iteration: 2, outcome: "success" }),
    ];
    const midRetry = replayRunData(implementationDefinition, rows, {
      implement: nodeState({ status: "running", iteration: 2 }),
    });
    const afterRetry = replayRunData(implementationDefinition, rows, {
      implement: nodeState({ status: "succeeded", iteration: 2 }),
    });

    expect(midRetry.taken).toEqual(new Set(["implement-implement-failed"]));
    expect(afterRetry.taken).toEqual(
      new Set(["implement-implement-failed", "implement-validate-success"]),
    );
  });

  it("excludes nodes the replayed state has not reached from executed", () => {
    const data = replayRunData(
      implementationDefinition,
      [
        row({ nodeId: "implement", outcome: "success" }),
        row({ nodeId: "validate", outcome: "success" }),
      ],
      {
        implement: nodeState({ status: "running", iteration: 1 }),
        validate: nodeState({ status: "idle", iteration: 0 }),
      },
    );

    expect(data.executed).toEqual(new Set(["implement"]));
  });

  it("counts a node with only transcript activity as executed", () => {
    const data = replayRunData(implementationDefinition, [], {
      implement: nodeState({
        status: "idle",
        transcript: [
          {
            id: "1",
            taskId: "task-1",
            agentCrName: null,
            assemblyLineId: "run-1",
            stationRunId: null,
            nodeId: "implement",
            iteration: 1,
            eventType: "tool_call",
            toolName: "Edit",
            toolUseId: null,
            isError: false,
            filePaths: [],
            summary: null,
            payload: {},
            createdAt: "2026-07-20T10:00:00.000Z",
          },
        ],
      }),
    });

    expect(data.executed).toEqual(new Set(["implement"]));
  });

  it("returns a null result even when a completed row failed", () => {
    const data = replayRunData(
      codeReviewDefinition,
      [row({ nodeId: "review", outcome: "failed" })],
      { review: nodeState({ status: "failed", iteration: 1 }) },
    );

    expect(data.result).toBeNull();
  });
});
