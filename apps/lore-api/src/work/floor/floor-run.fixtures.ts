// One small floor run, as the floor's API answers it: a review line with one agent node and a marker, one open visit and one turn.
import type {
  LineBody,
  LiveFrame,
  RunView,
  StationRunRecordView,
  VisitView,
} from "@re-cinq/floor-client";
import type { FloorRequest } from "@re-cinq/lore-shared/floor/recorded-floor.js";

export const SECRET_PROMPT = "You are the secret reviewer prompt";
export const PR_URL = "https://github.com/re-cinq/lore/pull/412";

export const FLOOR_RUN: RunView = {
  id: "run-1",
  lineId: "code-review",
  lineHash: "hash-1",
  repo: "github.com/re-cinq/lore",
  subjectKey: `pr_url:${PR_URL}`,
  startItems: {
    repo: { kind: "git", ref: "github.com/re-cinq/lore@fix/login", by: "lore" },
    pr_url: { kind: "value", ref: PR_URL, by: "lore" },
  },
  createdAt: "2026-09-30T10:00:00.000Z",
  outcome: null,
  reason: null,
  finishedAt: null,
};

export const FLOOR_VISIT: VisitView = {
  id: "visit-1",
  runId: "run-1",
  nodeId: "review",
  iteration: 1,
  stationHash: "station-hash",
  agentDefinitionHash: "agent-hash",
  brief: { needs: {}, iteration: 1 },
  report: null,
  worker: "cluster-agent-1",
  branch: null,
  requestedBy: null,
  deadline: "2026-09-30T10:30:00.000Z",
  resumedFrom: null,
  agentSettings: {
    model: "gemini-3.1-pro-preview",
    prompt: SECRET_PROMPT,
    image: "agent:1",
    timeoutMinutes: 25,
  },
};

export const FLOOR_LINE: LineBody = {
  entry: "review",
  exit: "done",
  args: { pr_url: { kind: "value", subject: true } },
  nodes: [{ id: "review", station: "code-review" }, { id: "done" }],
  edges: [{ from: "review", to: "done", on: "success" }],
};

export const ASSISTANT_TURN: StationRunRecordView = {
  visitId: "visit-1",
  kind: "turn",
  seq: 1,
  body: {
    type: "assistant",
    message: { content: [{ type: "text", text: "Reading the diff." }] },
  },
  occurredAt: "2026-09-30T10:05:00.000Z",
};

export const INIT_LOG: StationRunRecordView = {
  visitId: "visit-1",
  kind: "log",
  seq: 1,
  body: { kind: "lifecycle", tool: "git", phase: "init", status: "running" },
  occurredAt: "2026-09-30T10:01:00.000Z",
};

export function turnFrame(seq: number): Extract<LiveFrame, { type: "record" }> {
  return {
    type: "record",
    seq,
    visitId: "visit-1",
    nodeId: "review",
    iteration: 1,
    record: { ...ASSISTANT_TURN, seq },
  };
}

const ANSWERS: Record<string, unknown> = {
  "/assembly-runs/run-1": { run: FLOOR_RUN, bag: {} },
  "/station-runs?run=run-1": { items: [FLOOR_VISIT] },
  "/assembly-lines/code-review/versions/hash-1": {
    kind: "assembly-line",
    id: "code-review",
    hash: "hash-1",
    body: FLOOR_LINE,
    archivedAt: null,
    createdBy: null,
    createdAt: "2026-09-29T00:00:00.000Z",
  },
  "/stations/code-review": {
    kind: "station",
    id: "code-review",
    hash: "station-hash",
    body: { kind: "agent", outcomes: ["success"], needs: [], produces: [] },
    archivedAt: null,
    createdBy: null,
    createdAt: "2026-09-29T00:00:00.000Z",
  },
  "/events?run=run-1": {
    items: [{ id: "e1", createdAt: "2026-09-30T10:00:00.000Z" }],
    nextCursor: null,
  },
  "/costs?run=run-1&group=run": { items: [{ key: "run-1", costUsd: 0.42 }] },
  "/station-runs/visit-1/records?kind=turn&since=0&limit=1000": {
    items: [ASSISTANT_TURN],
    nextCursor: null,
  },
  "/station-runs/visit-1": FLOOR_VISIT,
  "/station-runs/visit-1/records?kind=log&since=0&limit=1000": {
    items: [INIT_LOG],
    nextCursor: null,
  },
};

/** The floor holding the one run above; any other path answers 404. */
export function floorWithOneRun(request: FloorRequest): unknown {
  return ANSWERS[request.path];
}

/** The floor with one run on a page that has a next one, and that run's cost. */
export function floorWithRunPage(request: FloorRequest): unknown {
  const url = new URL(request.path, "http://floor.test");

  if (url.pathname === "/costs") {
    return { items: [{ key: "run-1", costUsd: 0.42 }] };
  }

  return url.pathname === "/assembly-runs"
    ? { items: [FLOOR_RUN], nextCursor: "cursor-2" }
    : floorWithOneRun(request);
}
