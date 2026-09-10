import { describe, it, expect } from "vitest";
import {
  nodeOutcomeEvent,
  shouldRecordOutcome,
  type SettledNode,
} from "./node-outcome-event.js";

const row: SettledNode = {
  stationRunId: "sr-1",
  nodeId: "validate",
  iteration: 2,
  commitSha: "sha-red",
};

const at = new Date("2026-01-01T00:00:00.000Z");

describe("shouldRecordOutcome", () => {
  it("records for a run that names a repo", () => {
    expect(shouldRecordOutcome({ repo: "o/r" })).toBe(true);
  });

  it("refuses for a run with no repo, whose files belong to nothing", () => {
    expect(shouldRecordOutcome({ repo: null })).toBe(false);
  });
});

describe("nodeOutcomeEvent", () => {
  it("takes identity from the row and the failure from the verdict", () => {
    expect(
      nodeOutcomeEvent(
        { id: "run-7", repo: "o/r" },
        row,
        {
          outcome: "validate-failed",
          failureClass: "unknown",
          failureDetail: "src/widget.ts(12,5): error TS2345",
        },
        at,
      ),
    ).toEqual({
      eventName: "internal.ingest.spec_trace",
      params: {
        repo: "o/r",
        kind: "failure",
        payload: {
          outcome: "validate-failed",
          assemblyRunId: "run-7",
          stationRunId: "sr-1",
          nodeId: "validate",
          iteration: 2,
          failureClass: "unknown",
          failureDetail: "src/widget.ts(12,5): error TS2345",
          commit: "sha-red",
          occurredAt: "2026-01-01T00:00:00.000Z",
        },
      },
      dedupeKey: "node-outcome:sr-1:validate-failed",
    });
  });

  it("carries nulls for a verdict that names no failure", () => {
    const green = nodeOutcomeEvent(
      { id: "run-7", repo: "o/r" },
      row,
      { outcome: "success" },
      at,
    );

    expect(green.params.payload).toMatchObject({
      failureClass: null,
      failureDetail: null,
    });
  });

  it("keys a success separately from the failure on the same station run", () => {
    const green = nodeOutcomeEvent(
      { id: "run-7", repo: "o/r" },
      row,
      { outcome: "success" },
      at,
    );

    expect(green.dedupeKey).toBe("node-outcome:sr-1:success");
  });
});
