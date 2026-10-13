import { describe, expect, it } from "vitest";
import type { FloorEventView, LineBody } from "@re-cinq/floor-client";
import {
  recordedFloor,
  type FloorRequest,
} from "@re-cinq/lore-shared/floor/recorded-floor.js";
import { FLOOR_RUN } from "./floor-run.fixtures.js";
import {
  runNodeByHand,
  startEventFor,
  type FloorPatience,
  type HandStartLine,
} from "./run-node-by-hand.js";

const LINE: LineBody & HandStartLine = {
  entry: "review",
  exit: "done",
  fail: "gave-up",
  args: {},
  nodes: [
    { id: "review", station: "code-review" },
    { id: "post-review", station: "post-review", start: "manual.review.post" },
    { id: "done" },
    { id: "gave-up" },
  ],
  edges: [],
};

const POSTED: FloorEventView = {
  id: "event-7",
  name: "node.review.start",
  payload: { runId: "run-1", requestedBy: "gedaiu" },
  dedupeKey: null,
  tags: [],
  runId: null,
  availableAt: "2026-10-06T10:00:00.000Z",
  createdAt: "2026-10-06T10:00:00.000Z",
  claimedAt: null,
  claimedBy: null,
  ackedAt: null,
  attempts: 0,
  lastError: null,
  deadAt: null,
  droppedAt: null,
};

const ACKED = { ...POSTED, ackedAt: "2026-10-06T10:00:01.000Z" };

const DEAD = {
  ...POSTED,
  deadAt: "2026-10-06T10:00:01.000Z",
  lastError: "node review of run run-1 is already running",
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

describe("startEventFor", () => {
  it("answers node.review.start for the review node, which declares no start of its own", () => {
    expect(startEventFor(LINE, "review")).toBe("node.review.start");
  });

  it("answers manual.review.post for the post-review node, which declares that start", () => {
    expect(startEventFor(LINE, "post-review")).toBe("manual.review.post");
  });
});

describe("runNodeByHand", () => {
  it("posts node.review.start for run-1 in gedaiu's name and answers not pending once the floor acks it", async () => {
    const { floor, requests } = scene([POSTED, ACKED]);
    const answer = await runNodeByHand(floor, ask("review"), NO_WAIT);

    expect({ answer, posts: posts(requests) }).toEqual({
      answer: { runId: "run-1", pending: false },
      posts: [
        {
          method: "POST",
          path: "/events",
          body: {
            name: "node.review.start",
            payload: { runId: "run-1", requestedBy: "gedaiu" },
          },
        },
      ],
    });
  });

  it("answers pending when the floor has not taken the start within the wait", async () => {
    const { floor } = scene([]);

    expect(await runNodeByHand(floor, ask("review"), NO_WAIT)).toEqual({
      runId: "run-1",
      pending: true,
    });
  });

  it("refuses with 409 and the floor's reason when the floor dead-letters the start", async () => {
    const { floor } = scene([DEAD]);

    await expect(
      runNodeByHand(floor, ask("review"), NO_WAIT),
    ).rejects.toMatchObject({
      output: { statusCode: 409 },
      message: "node review of run run-1 is already running",
    });
  });

  it.each([
    ["done", "the exit"],
    ["gave-up", "the fail node"],
    ["nowhere", "a node the line does not have"],
  ])("refuses %s, %s, with 400 and posts nothing", async (nodeId) => {
    const { floor, requests } = scene([]);

    await expect(
      runNodeByHand(floor, ask(nodeId), NO_WAIT),
    ).rejects.toMatchObject({ output: { statusCode: 400 } });
    expect(posts(requests)).toEqual([]);
  });

  it("refuses run-2, which the floor does not have, with 404", async () => {
    const { floor } = scene([]);

    await expect(
      runNodeByHand(floor, ask("review", "run-2"), NO_WAIT),
    ).rejects.toMatchObject({
      output: { statusCode: 404 },
      message: "the floor has no run run-2",
    });
  });
});
