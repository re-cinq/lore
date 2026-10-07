import { describe, expect, it } from "vitest";
import { toStationRunRow } from "./station-run-row.js";

describe("toStationRunRow", () => {
  it("carries the failed issues visit's failureDetail 'body is too long' as failure_detail", () => {
    const row = toStationRunRow({
      id: "1",
      stationRunId: "visit-1",
      assemblyRunId: "run-1",
      nodeId: "issues",
      iteration: 1,
      status: "running",
      clusterAgentId: null,
      requiredTags: [],
      claimedAt: null,
      outcome: "failed",
      failureClass: null,
      failureDetail: "body is too long",
      agentCrName: null,
      input: null,
      commitSha: null,
      requestedBy: null,
      startedAt: new Date("2026-10-07T10:00:00Z"),
      finishedAt: new Date("2026-10-07T10:01:00Z"),
    });

    expect(row).toMatchObject({ failure_detail: "body is too long" });
  });
});
