import { describe, expect, it } from "vitest";
import type { StationRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { toStationRunRow } from "./station-run-row.js";

const tableVisit: StationRunRecord = {
  id: "1",
  stationRunId: "visit-1",
  assemblyRunId: "run-1",
  nodeId: "implement",
  iteration: 1,
  status: "running",
  clusterAgentId: null,
  requiredTags: [],
  claimedAt: null,
  outcome: null,
  failureClass: null,
  failureDetail: null,
  agentCrName: "agent-1",
  input: null,
  commitSha: null,
  requestedBy: null,
  startedAt: new Date("2026-10-07T10:00:00Z"),
  finishedAt: null,
};

describe("toStationRunRow", () => {
  it("carries a floor visit's needs target and pr_url", () => {
    const needs = { target: "github.com/re-cinq/lore@main", pr_url: "u" };

    expect(toStationRunRow({ ...tableVisit, needs })).toMatchObject({ needs });
  });

  it("carries produced, worker cluster-agent-1, requested_by bogdan and route_url of a floor visit", () => {
    const floorVisit = {
      ...tableVisit,
      clusterAgentId: "cluster-agent-1",
      requestedBy: "bogdan",
      produced: { plan: "sha256-abc" },
      routeUrl: "/repos/re-cinq/lore/plans/plan-7",
    };

    expect(toStationRunRow(floorVisit)).toMatchObject({
      produced: { plan: "sha256-abc" },
      worker: "cluster-agent-1",
      requested_by: "bogdan",
      route_url: "/repos/re-cinq/lore/plans/plan-7",
    });
  });

  it("nulls produced and route_url for a table-backed visit", () => {
    expect(toStationRunRow(tableVisit)).toMatchObject({
      produced: null,
      route_url: null,
    });
  });

  it("gives a table-backed visit without needs a null needs", () => {
    expect(toStationRunRow(tableVisit)).toMatchObject({ needs: null });
  });

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
