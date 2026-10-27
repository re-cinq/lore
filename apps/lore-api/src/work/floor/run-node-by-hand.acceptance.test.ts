import { describe, expect, it } from "vitest";
import type { FloorEventView, LineBody } from "@re-cinq/floor-client";
import {
  recordedFloor,
  type FloorRequest,
} from "@re-cinq/lore-shared/floor/recorded-floor.js";
import { FLOOR_RUN } from "./floor-run.fixtures.js";
import {
  runNodeByHand,
  type FloorPatience,
  type HandStartLine,
} from "./run-node-by-hand.js";

const LINE = {
  entry: "start",
  exit: "done",
  fail: "gave-up",
  args: {},
  nodes: [
    { id: "start" },
    { id: "await-ci", station: "loop-await-ci" },
    { id: "repair-build", station: "loop-repair-build" },
    { id: "tdd-round", station: "loop-tdd-round" },
    { id: "ready-for-review", station: "loop-ready-for-review" },
    { id: "await-pr", station: "loop-await-pr" },
    { id: "sync-pr", station: "loop-sync-check" },
    { id: "fix-ci", station: "loop-fix-ci" },
    { id: "done" },
    { id: "gave-up" },
  ],
  edges: [
    { from: "start", to: "tdd-round", on: "success" },
    { from: "await-ci", to: "tdd-round", on: "changes_requested" },
    { from: "await-ci", to: "repair-build", on: "failed" },
    { from: "repair-build", to: "repair-build", on: "failed" },
    { from: "await-ci", to: "ready-for-review", on: "success" },
    { from: "await-pr", to: "sync-pr", on: "changes_requested" },
    { from: "sync-pr", to: "fix-ci", on: "success" },
  ],
} as unknown as LineBody & HandStartLine;

const POSTED: FloorEventView = {
  id: "event-7",
  name: "node.await-ci.start",
  payload: { runId: "run-1", requestedBy: "gedaiu" },
  dedupeKey: null,
  tags: [],
  runId: null,
  availableAt: "2026-10-06T10:00:00.000Z",
  createdAt: "2026-10-06T10:00:00.000Z",
  claimedAt: null,
  claimedBy: null,
  ackedAt: "2026-10-06T10:00:01.000Z",
  attempts: 0,
  lastError: null,
  deadAt: null,
  droppedAt: null,
};

const NO_WAIT: FloorPatience = {
  pollMs: 250,
  budgetMs: 1_000,
  sleep: () => Promise.resolve(),
};

const ANSWERS: Record<string, unknown> = {
  "GET /assembly-runs/run-1": {
    run: { ...FLOOR_RUN, finishedAt: "2026-10-01T10:00:00.000Z" },
    bag: {},
  },
  "GET /assembly-lines/code-review/versions/hash-1": {
    kind: "line",
    id: "code-review",
    hash: "hash-1",
    body: LINE,
  },
  "POST /events": POSTED,
};

function scene(polled: FloorEventView[]) {
  const reads = [...polled];
  const recorded = recordedFloor((request: FloorRequest) => {
    const asked = `${request.method} ${request.path}`;

    return asked === "GET /events/event-7"
      ? (reads.shift() ?? POSTED)
      : ANSWERS[asked];
  });

  return { floor: recorded.floor, requests: recorded.requests };
}

const ask = (nodeId: string, runId = "run-1") => ({
  runId,
  nodeId,
  actor: "gedaiu",
});

const posts = (requests: FloorRequest[]) =>
  requests.filter((request) => request.method === "POST");

const startedEvent = async (nodeId: string) => {
  const { floor, requests } = scene([POSTED]);

  await runNodeByHand(floor, ask(nodeId), NO_WAIT);

  return posts(requests).map((request) => request.body);
};

describe("runNodeByHand", () => {
  it("routes a retry of a node fed by CI (repair-build) through await-ci so CI re-judges the branch", async () => {
    const { floor, requests } = scene([POSTED]);

    const answer = await runNodeByHand(floor, ask("repair-build"), NO_WAIT);

    expect({ answer, posts: posts(requests) }).toEqual({
      answer: { runId: "run-1", pending: false },
      posts: [
        {
          method: "POST",
          path: "/events",
          body: {
            name: "node.await-ci.start",
            payload: { runId: "run-1", requestedBy: "gedaiu" },
          },
        },
      ],
    });
  });

  it("routes a retry of fix-ci behind await-pr through await-pr", async () => {
    expect(await startedEvent("fix-ci")).toEqual([
      {
        name: "node.await-pr.start",
        payload: { runId: "run-1", requestedBy: "gedaiu" },
      },
    ]);
  });

  it("starts ready-for-review itself when CI's green outcome feeds it", async () => {
    expect(await startedEvent("ready-for-review")).toEqual([
      {
        name: "node.ready-for-review.start",
        payload: { runId: "run-1", requestedBy: "gedaiu" },
      },
    ]);
  });

  it("starts tdd-round itself when a step besides the CI wait feeds it", async () => {
    expect(await startedEvent("tdd-round")).toEqual([
      {
        name: "node.tdd-round.start",
        payload: { runId: "run-1", requestedBy: "gedaiu" },
      },
    ]);
  });
});
