import { describe, it, expect } from "vitest";
import {
  advanceCursor,
  segmentLabel,
  segmentTurns,
  taskLogsUrl,
  walkContinues,
} from "./task-logs-presenter";
import {
  MAX_TURNS_LOADED,
  TURNS_PAGE_LIMIT,
} from "@/app/assembly-runs/[id]/turn-transcript-presenter";
import type { AgentRunTurn } from "@/lib/run-turn-types";

function turn(over: Partial<AgentRunTurn> = {}): AgentRunTurn {
  return {
    id: "1",
    taskId: "t1",
    agentCrName: null,
    assemblyLineId: null,
    nodeId: null,
    iteration: null,
    stationRunId: null,
    eventType: null,
    envelope: {},
    createdAt: "2026-08-18T00:00:00.000Z",
    ...over,
  };
}

describe("taskLogsUrl", () => {
  it("builds the bare page-limit URL for the zero cursor", () => {
    expect(taskLogsUrl("task-1", "0")).toBe(
      `/api/tasks/task-1/logs?limit=${TURNS_PAGE_LIMIT}`,
    );
  });

  it("appends the after param for a nonzero cursor", () => {
    expect(taskLogsUrl("task-1", "42")).toBe(
      `/api/tasks/task-1/logs?limit=${TURNS_PAGE_LIMIT}&after=42`,
    );
  });

  it("URI-encodes the task id", () => {
    expect(taskLogsUrl("a/b", "0")).toBe(
      `/api/tasks/a%2Fb/logs?limit=${TURNS_PAGE_LIMIT}`,
    );
  });
});

describe("advanceCursor", () => {
  it("returns the last row's string id", () => {
    expect(advanceCursor([{ id: "7" }, { id: "9" }], "0")).toBe("9");
  });

  it("skips trailing rows without a string id", () => {
    expect(advanceCursor([{ id: "7" }, { id: 8 }, {}], "0")).toBe("7");
  });

  it("keeps the current cursor for an empty page", () => {
    expect(advanceCursor([], "13")).toBe("13");
  });

  it("keeps the current cursor when no row carries a string id", () => {
    expect(advanceCursor([{ id: 8 }, null], "13")).toBe("13");
  });
});

describe("walkContinues", () => {
  it("continues on a full page below the load cap", () => {
    expect(walkContinues(new Array(TURNS_PAGE_LIMIT).fill({}), 0)).toBe(true);
  });

  it("stops on a page one row short of the limit", () => {
    expect(walkContinues(new Array(TURNS_PAGE_LIMIT - 1).fill({}), 0)).toBe(
      false,
    );
  });

  it("stops on a short page", () => {
    expect(walkContinues([{}], 0)).toBe(false);
  });

  it("stops at the load cap even when the page is full", () => {
    expect(
      walkContinues(new Array(TURNS_PAGE_LIMIT).fill({}), MAX_TURNS_LOADED),
    ).toBe(false);
  });
});

describe("segmentTurns", () => {
  it("groups consecutive turns sharing nodeId and iteration into one segment", () => {
    const segments = segmentTurns([
      turn({ id: "1", nodeId: "review", iteration: 1, envelope: { a: 1 } }),
      turn({ id: "2", nodeId: "review", iteration: 1, envelope: { b: 2 } }),
    ]);

    expect(segments).toEqual([
      {
        nodeId: "review",
        iteration: 1,
        rawLog: '{"a":1}\n{"b":2}',
      },
    ]);
  });

  it("starts a new segment when the node or iteration changes", () => {
    const segments = segmentTurns([
      turn({ id: "1", nodeId: "implement", iteration: 1 }),
      turn({ id: "2", nodeId: "review", iteration: 1 }),
      turn({ id: "3", nodeId: "review", iteration: 2 }),
    ]);

    expect(segments.map((s) => [s.nodeId, s.iteration])).toEqual([
      ["implement", 1],
      ["review", 1],
      ["review", 2],
    ]);
  });

  it("keeps uncorrelated turns in their own null-node segment", () => {
    const segments = segmentTurns([
      turn({ id: "1", nodeId: null, iteration: null, envelope: { a: 1 } }),
      turn({ id: "2", nodeId: "review", iteration: 1, envelope: { b: 2 } }),
    ]);

    expect(segments.map((s) => s.nodeId)).toEqual([null, "review"]);
  });

  it("returns no segments for no turns", () => {
    expect(segmentTurns([])).toEqual([]);
  });
});

describe("segmentLabel", () => {
  it("is null for a segment with no node correlation", () => {
    expect(
      segmentLabel({ nodeId: null, iteration: null, rawLog: "" }),
    ).toBeNull();
  });

  it("names the node alone when the iteration is unknown", () => {
    expect(
      segmentLabel({ nodeId: "review", iteration: null, rawLog: "" }),
    ).toBe("review");
  });

  it("names the node and iteration", () => {
    expect(segmentLabel({ nodeId: "review", iteration: 2, rawLog: "" })).toBe(
      "review · iteration 2",
    );
  });
});

describe("walkContinues with the Floor's hasMore flag", () => {
  it("continues on a short page below the load cap when hasMore is true", () => {
    expect(walkContinues([{}], 0, true)).toBe(true);
  });

  it("stops on a full page when hasMore is false", () => {
    expect(walkContinues(new Array(TURNS_PAGE_LIMIT).fill({}), 0, false)).toBe(
      false,
    );
  });

  it("falls back to the short-page rule when the response carries no flag", () => {
    expect(walkContinues([{}], 0, undefined)).toBe(false);
    expect(
      walkContinues(new Array(TURNS_PAGE_LIMIT).fill({}), 0, undefined),
    ).toBe(true);
  });

  it("stops at the load cap even when hasMore is true", () => {
    expect(walkContinues([{}], MAX_TURNS_LOADED, true)).toBe(false);
  });
});
