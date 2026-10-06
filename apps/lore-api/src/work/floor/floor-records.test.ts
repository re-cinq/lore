import { describe, expect, it } from "vitest";
import {
  floorVisitIdOf,
  nodeLogsOf,
  recordToAgentEvents,
} from "./floor-records.js";
import { ASSISTANT_TURN, FLOOR_VISIT, INIT_LOG } from "./floor-run.fixtures.js";

describe("recordToAgentEvents", () => {
  const place = {
    runId: "run-1",
    visitId: "visit-1",
    nodeId: "review",
    iteration: 2,
    seq: 7,
  };

  it("numbers the assistant turn by the journal's seq 7, not its own record seq 1: agent event 700 of visit-1 at iteration 2", () => {
    expect(recordToAgentEvents(ASSISTANT_TURN, place)).toMatchObject([
      {
        id: "700",
        assemblyLineId: "run-1",
        stationRunId: "visit-1",
        nodeId: "review",
        iteration: 2,
        agentCrName: "floor-visit-1",
        eventType: "message",
        createdAt: new Date("2026-09-30T10:05:00.000Z"),
      },
    ]);
  });

  it("draws nothing from a log record", () => {
    expect(recordToAgentEvents(INIT_LOG, place)).toEqual([]);
  });
});

describe("floorVisitIdOf", () => {
  it("reads visit-1 out of floor-visit-1", () => {
    expect(floorVisitIdOf("floor-visit-1")).toBe("visit-1");
  });

  it("reads null out of a Lore pod's name cr-implement", () => {
    expect(floorVisitIdOf("cr-implement")).toBeNull();
  });
});

describe("nodeLogsOf", () => {
  const reported = { ...FLOOR_VISIT, report: { outcome: "success" } };

  it("joins the log records into lines stamped with their time, Succeeded once the visit reported success", () => {
    expect(nodeLogsOf(reported, [INIT_LOG], undefined)).toEqual({
      available: true,
      logs: "2026-09-30T10:01:00.000Z kind=lifecycle tool=git phase=init status=running",
      phase: "Succeeded",
      podName: null,
      archived: true,
    });
  });

  it("keeps the last 1 line for tail 1, and reads Running while the visit is open", () => {
    const later = { ...INIT_LOG, seq: 2, body: "second line" };

    expect(nodeLogsOf(FLOOR_VISIT, [INIT_LOG, later], 1)).toMatchObject({
      logs: "2026-09-30T10:01:00.000Z second line",
      phase: "Running",
    });
  });

  it("answers an empty but available log, Running, for an open visit with no record yet, so the panel keeps polling", () => {
    expect(nodeLogsOf(FLOOR_VISIT, [], undefined)).toMatchObject({
      available: true,
      logs: "",
      phase: "Running",
    });
  });

  it("says the floor kept no records, Failed, for a failed visit with no log", () => {
    const failed = { ...FLOOR_VISIT, report: { outcome: "failed" } };

    expect(nodeLogsOf(failed, [], undefined)).toEqual({
      available: false,
      logs: null,
      phase: "Failed",
      podName: null,
      archived: true,
      reason: "no-records",
    });
  });
});
