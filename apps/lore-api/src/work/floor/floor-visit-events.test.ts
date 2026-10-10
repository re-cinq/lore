import { describe, expect, it } from "vitest";
import type { FloorEventView } from "@re-cinq/floor-client";
import { visitEventsOf } from "./floor-visit-events.js";

const event = (
  id: string,
  name: string,
  payload: Record<string, unknown>,
  over: Partial<FloorEventView> = {},
): FloorEventView => ({
  id,
  name,
  payload,
  dedupeKey: null,
  tags: [],
  runId: "run-1",
  availableAt: "2026-10-10T10:00:00.000Z",
  createdAt: `2026-10-10T10:00:0${id}.000Z`,
  claimedAt: null,
  claimedBy: null,
  ackedAt: "2026-10-10T10:00:09.000Z",
  attempts: 1,
  lastError: null,
  deadAt: null,
  droppedAt: null,
  ...over,
});

const visit = {
  id: "visit-1",
  nodeId: "review",
  iteration: 2,
  requestedBy: null,
  startEvent: "node.review.start",
};

const nameAndSide = (rows: ReturnType<typeof visitEventsOf>) =>
  rows.map((row) => `${row.direction}:${row.name}${row.inferred ? "?" : ""}`);

describe("visitEventsOf", () => {
  it("counts the start event for review's iteration 2 as handled, inferred", () => {
    const start = event("1", "node.review.start", {
      nodeId: "review",
      iteration: 2,
    });

    expect(nameAndSide(visitEventsOf(visit, [start]))).toEqual([
      "handled:node.review.start?",
    ]);
  });

  it("ignores the start event of review's iteration 1", () => {
    const earlier = event("1", "node.review.start", {
      nodeId: "review",
      iteration: 1,
    });

    expect(visitEventsOf(visit, [earlier])).toEqual([]);
  });

  it("counts the visit's dispatch and abort as handled and its report as raised, exactly", () => {
    const events = [
      event("2", "station_run.dispatch", { visitId: "visit-1" }),
      event("3", "station_run.reported", {
        visitId: "visit-1",
        report: { outcome: "success" },
      }),
      event("4", "station_run.abort", { visitId: "visit-1" }),
    ];

    expect(nameAndSide(visitEventsOf(visit, events))).toEqual([
      "handled:station_run.dispatch",
      "raised:station_run.reported",
      "handled:station_run.abort",
    ]);
  });

  it("counts the next node's start, caused by the visit's report, as raised", () => {
    const next = event("5", "node.post-review.start", {
      nodeId: "post-review",
      iteration: 1,
      causedBy: { visitId: "visit-1" },
    });

    expect(nameAndSide(visitEventsOf(visit, [next]))).toEqual([
      "raised:node.post-review.start",
    ]);
  });

  it("counts the outside event that answered visit-0 and visit-1 as handled by visit-1", () => {
    const closed = event("6", "github.pull_request.closed", {
      merged: true,
      answeredVisitIds: ["visit-0", "visit-1"],
    });

    expect(nameAndSide(visitEventsOf(visit, [closed]))).toEqual([
      "handled:github.pull_request.closed",
    ]);
  });

  it("leaves out another visit's dispatch", () => {
    const other = event("7", "station_run.dispatch", { visitId: "visit-9" });

    expect(visitEventsOf(visit, [other])).toEqual([]);
  });

  it("counts a by-hand start, which names no iteration, for a visit someone ran by hand", () => {
    const byHand = event("8", "node.review.start", {
      nodeId: "review",
      requestedBy: "bogdan",
    });

    expect(
      nameAndSide(visitEventsOf({ ...visit, requestedBy: "bogdan" }, [byHand])),
    ).toEqual(["handled:node.review.start?"]);
  });

  it("carries the event's attempts, error and acknowledgement onto its row", () => {
    const failed = event(
      "9",
      "station_run.dispatch",
      { visitId: "visit-1" },
      {
        attempts: 3,
        lastError: "pod evicted",
        ackedAt: null,
        claimedBy: "cluster-agent-1",
      },
    );

    expect(visitEventsOf(visit, [failed])[0]).toMatchObject({
      attempts: 3,
      last_error: "pod evicted",
      acked_at: null,
      claimed_by: "cluster-agent-1",
    });
  });
});
