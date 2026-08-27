import { describe, it, expect } from "vitest";
import {
  segmentLabel,
  segmentRawLog,
  segmentTurns,
  type TurnSegment,
} from "./turn-segments";
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

function segment(over: Partial<TurnSegment> = {}): TurnSegment {
  return { nodeId: null, iteration: null, turns: [], ...over };
}

describe("segmentTurns", () => {
  it("groups consecutive turns sharing nodeId and iteration into one segment", () => {
    const segments = segmentTurns([
      turn({ id: "1", nodeId: "review", iteration: 1, envelope: { a: 1 } }),
      turn({ id: "2", nodeId: "review", iteration: 1, envelope: { b: 2 } }),
    ]);

    expect(segments).toMatchObject([
      {
        nodeId: "review",
        iteration: 1,
        turns: [{ id: "1" }, { id: "2" }],
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
    expect(segmentLabel(segment())).toBeNull();
  });

  it("names the node alone when the iteration is unknown", () => {
    expect(segmentLabel(segment({ nodeId: "review" }))).toBe("review");
  });

  it("names the node and iteration", () => {
    expect(segmentLabel(segment({ nodeId: "review", iteration: 2 }))).toBe(
      "review · iteration 2",
    );
  });
});

describe("segmentRawLog", () => {
  it("joins the segment's envelopes one per line", () => {
    const raw = segmentRawLog(
      segment({
        turns: [
          turn({ id: "1", envelope: { a: 1 } }),
          turn({ id: "2", envelope: { b: 2 } }),
        ],
      }),
    );

    expect(raw).toBe('{"a":1}\n{"b":2}');
  });

  it("is empty for a segment with no turns", () => {
    expect(segmentRawLog(segment())).toBe("");
  });
});
