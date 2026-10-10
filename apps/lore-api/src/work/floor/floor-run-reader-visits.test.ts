import { describe, expect, it } from "vitest";
import type {
  FloorEventView,
  LineBody,
  VisitView,
} from "@re-cinq/floor-client";
import {
  recordedFloor,
  type FloorRequest,
} from "@re-cinq/lore-shared/floor/recorded-floor.js";
import { FLOOR_RUN, FLOOR_VISIT } from "./floor-run.fixtures.js";
import { FloorRunReader } from "./floor-run-reader.js";

const LINE: LineBody = {
  entry: "review",
  exit: "done",
  args: {},
  nodes: [
    { id: "review", station: "code-review" },
    { id: "author", station: "plan-author" },
    { id: "done" },
  ],
  edges: [
    { from: "review", to: "author", on: "success" },
    { from: "author", to: "done", on: "success" },
  ],
};

const AUTHOR_VISIT: VisitView = {
  ...FLOOR_VISIT,
  id: "visit-2",
  nodeId: "author",
  brief: { needs: { plan_id: "plan-7" }, iteration: 1 },
  agentSettings: null,
  worker: null,
};

const station = (id: string, body: unknown) => ({
  kind: "station",
  id,
  hash: `${id}-hash`,
  body,
  archivedAt: null,
  createdBy: null,
  createdAt: "2026-09-29T00:00:00.000Z",
});

const floorEvent = (
  id: string,
  name: string,
  payload: Record<string, unknown>,
): FloorEventView => ({
  id,
  name,
  payload,
  dedupeKey: null,
  tags: [],
  runId: "run-1",
  availableAt: "2026-09-30T10:00:00.000Z",
  createdAt: "2026-09-30T10:00:00.000Z",
  claimedAt: null,
  claimedBy: null,
  ackedAt: "2026-09-30T10:00:01.000Z",
  attempts: 1,
  lastError: null,
  deadAt: null,
  droppedAt: null,
});

const ANSWERS: Record<string, unknown> = {
  "/assembly-runs/run-1": { run: FLOOR_RUN, bag: {} },
  "/station-runs?run=run-1": { items: [FLOOR_VISIT, AUTHOR_VISIT] },
  "/station-runs/visit-1": FLOOR_VISIT,
  "/assembly-lines/code-review/versions/hash-1": {
    kind: "assembly-line",
    id: "code-review",
    hash: "hash-1",
    body: LINE,
    archivedAt: null,
    createdBy: null,
    createdAt: "2026-09-29T00:00:00.000Z",
  },
  "/stations/code-review": station("code-review", {
    kind: "agent",
    outcomes: ["success"],
    needs: [],
    produces: [],
  }),
  "/stations/plan-author": station("plan-author", {
    kind: "human",
    outcomes: ["success"],
    needs: [{ name: "plan_id", kind: "value" }],
    produces: [{ name: "plan", kind: "file" }],
    route: "/repos/{repo}/plans/{plan_id}",
  }),
  "/station-runs/visit-1/records?kind=llm_call&since=0&limit=1000": {
    items: [
      {
        visitId: "visit-1",
        kind: "llm_call",
        seq: 1,
        body: {
          model: "gemini-3.1-pro",
          costUsd: 0.02,
          usage: { input_tokens: 10, output_tokens: 2 },
        },
        occurredAt: "2026-09-30T10:05:00.000Z",
      },
    ],
    nextCursor: null,
  },
  "/events?run=run-1&limit=200": {
    items: [
      floorEvent("1", "node.review.start", { nodeId: "review", iteration: 1 }),
      floorEvent("2", "station_run.dispatch", { visitId: "visit-1" }),
    ],
    nextCursor: "2",
  },
  "/events?run=run-1&since=2&limit=200": {
    items: [
      floorEvent("3", "node.author.start", {
        nodeId: "author",
        iteration: 1,
        causedBy: { visitId: "visit-1" },
      }),
    ],
    nextCursor: null,
  },
};

function reader() {
  const recorded = recordedFloor(
    (request: FloorRequest) => ANSWERS[request.path],
  );

  return new FloorRunReader(recorded.floor);
}

describe("FloorRunReader visits", () => {
  it("resolves the author node's route from the station the line names", async () => {
    const visits = await reader().listStationRuns("run-1");

    expect(visits.find((visit) => visit.nodeId === "author")?.routeUrl).toBe(
      "/repos/re-cinq/lore/plans/plan-7",
    );
  });

  it("reads visit-1's llm_call record as one model call", async () => {
    expect(await reader().visitModelCalls("run-1", "visit-1")).toMatchObject([
      { model: "gemini-3.1-pro", costUsd: 0.02, tokensIn: 10, tokensOut: 2 },
    ]);
  });

  it("answers null model calls for visit-1 asked of run-2", async () => {
    expect(await reader().visitModelCalls("run-2", "visit-1")).toBeNull();
  });

  it("reads every page of run-1's events and keeps visit-1's start, dispatch and the start its report caused", async () => {
    const events = await reader().visitEvents("run-1", "visit-1");

    expect(events?.map((row) => `${row.direction}:${row.name}`)).toEqual([
      "handled:node.review.start",
      "handled:station_run.dispatch",
      "raised:node.author.start",
    ]);
  });

  it("answers null events for visit-1 asked of run-2", async () => {
    expect(await reader().visitEvents("run-2", "visit-1")).toBeNull();
  });
});
