import { describe, expect, it } from "vitest";
import type {
  LineBody,
  RunView,
  StationRunRecordView,
  VisitView,
} from "@re-cinq/floor-client";
import {
  agentEventId,
  floorCursorOf,
  floorRunToAssemblyRun,
  lineBodyToRunGraph,
  turnRecordToRow,
  visitToStationRun,
} from "./floor-run-mapping.js";

const CREATED_AT = new Date("2026-09-30T10:00:00.000Z");
const SECRET_PROMPT = "You are the secret reviewer prompt";

const openRun: RunView = {
  id: "run-1",
  lineId: "code-review",
  lineHash: "hash-1",
  repo: "github.com/re-cinq/lore",
  subjectKey: "pr:412",
  startItems: {
    repo: { kind: "git", ref: "github.com/re-cinq/lore@fix/login", by: "hook" },
    pr_url: {
      kind: "value",
      ref: "https://github.com/re-cinq/lore/pull/412",
      by: "hook",
    },
  },
  createdAt: "2026-09-30T10:00:00.000Z",
  outcome: null,
  reason: null,
  finishedAt: null,
};

const visit: VisitView = {
  id: "visit-1",
  runId: "run-1",
  nodeId: "review",
  iteration: 2,
  stationHash: null,
  agentDefinitionHash: null,
  brief: { needs: {}, iteration: 2 },
  report: null,
  worker: null,
  requestedBy: "alice",
  deadline: null,
  resumedFrom: null,
  agentSettings: null,
};

const line: LineBody = {
  entry: "review",
  exit: "done",
  args: {},
  nodes: [
    { id: "review", station: "reviewer@abc123" },
    { id: "check", station: "linter" },
    { id: "approve", station: "person" },
    { id: "mystery", station: "unlisted" },
    { id: "done" },
  ],
  edges: [{ from: "review", to: "review", on: "changes", iterationMax: 3 }],
};

const stationKinds = {
  reviewer: "agent",
  linter: "service",
  person: "human",
} as const;

const graph = lineBodyToRunGraph("code-review", line, stationKinds);

describe("lineBodyToRunGraph", () => {
  it("maps stations to node types and a stationless node to retrospective", () => {
    expect(
      graph.nodes.map(({ id, type, station }) => ({ id, type, station })),
    ).toEqual([
      { id: "review", type: "agent", station: "reviewer" },
      { id: "check", type: "validate", station: "linter" },
      { id: "approve", type: "pr_review", station: null },
      { id: "mystery", type: "agent", station: "unlisted" },
      { id: "done", type: "retrospective", station: null },
    ]);
  });

  it("carries entry, exit and edge iterationMax as iteration_max", () => {
    expect(graph).toMatchObject({
      name: "code-review",
      entry: "review",
      exit: "done",
      edges: [
        { from: "review", to: "review", on: "changes", iteration_max: 3 },
      ],
    });
  });
});

describe("floorRunToAssemblyRun", () => {
  const convert = (run: RunView, visits: VisitView[] = []) =>
    floorRunToAssemblyRun({ run, visits, graph });

  it("maps an open run with no visits to a queued record", () => {
    expect(convert(openRun)).toEqual({
      id: "run-1",
      blueprintName: "code-review",
      taskId: null,
      repo: "re-cinq/lore",
      branch: "fix/login",
      subjectKey: "pr:412",
      args: {
        engine: "floor",
        pr_url: "https://github.com/re-cinq/lore/pull/412",
        pr_number: 412,
      },
      status: "queued",
      outcome: null,
      reason: null,
      blueprintHash: "hash-1",
      graph,
      resumedFromRunId: null,
      resumedFromNodeId: null,
      inheritedNodeCount: 0,
      createdAt: CREATED_AT,
      startedAt: CREATED_AT,
      finishedAt: null,
    });
  });

  it("maps an open run with one visit to running", () => {
    expect(convert(openRun, [visit]).status).toBe("running");
  });

  it("maps a finished run with outcome error to failed", () => {
    const finished = {
      ...openRun,
      outcome: "error",
      reason: "pod died",
      finishedAt: "2026-09-30T11:00:00.000Z",
    };

    expect(convert(finished, [visit])).toMatchObject({
      status: "failed",
      outcome: "error",
      reason: "pod died",
      finishedAt: new Date("2026-09-30T11:00:00.000Z"),
    });
  });

  it("maps a finished run with outcome approved to finished", () => {
    const finished = {
      ...openRun,
      outcome: "approved",
      finishedAt: "2026-09-30T11:00:00.000Z",
    };

    expect(convert(finished).status).toBe("finished");
  });

  it("maps a run without git start items to a null branch and no pr_number", () => {
    const run = { ...openRun, startItems: {} };

    expect(convert(run)).toMatchObject({
      branch: null,
      args: { engine: "floor" },
    });
  });
});

describe("a visit waiting on a person", () => {
  const authored = lineBodyToRunGraph(
    "feature-planning",
    {
      entry: "author",
      exit: "done",
      args: {},
      nodes: [
        { id: "author", station: "plan-author" },
        { id: "merged", station: "spec-pr-merged" },
        { id: "analyze", station: "plan-analyze" },
        { id: "done" },
      ],
      edges: [],
    },
    {
      "plan-author": "author",
      "spec-pr-merged": "human",
      "plan-analyze": "agent",
    },
  );
  const run = {
    id: "run-1",
    repo: "re-cinq/lore",
    createdAt: CREATED_AT,
    graph: authored,
  };

  it("draws the human station that produces something as feature_review and the one that waits outside as pr_review, neither naming a station", () => {
    expect(authored.nodes.slice(0, 2)).toMatchObject([
      { id: "author", type: "feature_review", station: null },
      { id: "merged", type: "pr_review", station: null },
    ]);
  });

  it("gives the author visit no pod name, since no pod runs it", () => {
    expect(
      visitToStationRun({ ...visit, nodeId: "author" }, run).agentCrName,
    ).toBeNull();
  });

  it("keeps the pod name floor-visit-1 on the analyze visit of the same run", () => {
    expect(
      visitToStationRun({ ...visit, nodeId: "analyze" }, run).agentCrName,
    ).toBe("floor-visit-1");
  });
});

describe("visitToStationRun", () => {
  const run = { id: "run-1", repo: "re-cinq/lore", createdAt: CREATED_AT };

  it("maps a fresh visit to a queued station run named floor-visit-1", () => {
    expect(visitToStationRun(visit, run)).toEqual({
      id: "visit-1",
      stationRunId: "visit-1",
      assemblyRunId: "run-1",
      nodeId: "review",
      iteration: 2,
      status: "queued",
      clusterAgentId: null,
      requiredTags: [],
      claimedAt: null,
      outcome: null,
      failureClass: null,
      failureDetail: null,
      agentCrName: "floor-visit-1",
      input: null,
      commitSha: null,
      requestedBy: "alice",
      startedAt: CREATED_AT,
      finishedAt: null,
    });
  });

  it("maps a visit with a deadline and no worker to claimed with tags and claim time", () => {
    const claimed: VisitView = {
      ...visit,
      deadline: "2026-09-30T10:30:00.000Z",
      agentSettings: {
        prompt: SECRET_PROMPT,
        image: "img",
        timeoutMinutes: 30,
        tags: ["gpu"],
      },
    };

    expect(visitToStationRun(claimed, run)).toMatchObject({
      status: "claimed",
      requiredTags: ["gpu"],
      claimedAt: new Date("2026-09-30T10:00:00.000Z"),
      startedAt: new Date("2026-09-30T10:00:00.000Z"),
    });
  });

  it("maps a visit with a worker to running", () => {
    expect(
      visitToStationRun({ ...visit, worker: "agent-7" }, run),
    ).toMatchObject({ status: "running", clusterAgentId: "agent-7" });
  });

  it("maps a reported visit to running with its outcome and error", () => {
    const reported: VisitView = {
      ...visit,
      worker: "agent-7",
      report: { outcome: "failed", error: "out of memory" },
    };

    expect(visitToStationRun(reported, run)).toMatchObject({
      status: "running",
      outcome: "failed",
      failureDetail: "out of memory",
    });
  });

  it("leaves the agent prompt out of the serialized station run", () => {
    const withPrompt: VisitView = {
      ...visit,
      agentSettings: { prompt: SECRET_PROMPT, image: "img", timeoutMinutes: 5 },
    };

    expect(JSON.stringify(visitToStationRun(withPrompt, run))).not.toContain(
      SECRET_PROMPT,
    );
  });
});

describe("turnRecordToRow", () => {
  const target = {
    id: "visit-1",
    runId: "run-1",
    nodeId: "review",
    iteration: 2,
  };
  const record = (body: unknown): StationRunRecordView => ({
    visitId: "visit-1",
    kind: "turn",
    seq: 9,
    body,
    occurredAt: "2026-09-30T10:05:00.000Z",
  });

  it("maps a record with a typed body to a turn row", () => {
    expect(
      turnRecordToRow(record({ type: "assistant", n: 1 }), target),
    ).toEqual({
      id: "9",
      taskId: null,
      agentCrName: "floor-visit-1",
      assemblyLineId: "run-1",
      stationRunId: "visit-1",
      nodeId: "review",
      iteration: 2,
      eventType: "assistant",
      envelope: { source: {}, event: { type: "assistant", n: 1 } },
      createdAt: new Date("2026-09-30T10:05:00.000Z"),
    });
  });

  it("maps a record whose body is a string to event type unknown", () => {
    expect(turnRecordToRow(record("plain text"), target).eventType).toBe(
      "unknown",
    );
  });
});

describe("agent event cursor", () => {
  it("encodes seq 7 row 3 as 703", () => {
    expect(agentEventId(7, 3)).toBe("703");
  });

  it("decodes cursor 703 to floor seq 7", () => {
    expect(floorCursorOf("703")).toBe(7);
  });

  it("decodes an absent or zero cursor to undefined", () => {
    expect([floorCursorOf(undefined), floorCursorOf("0")]).toEqual([
      undefined,
      undefined,
    ]);
  });
});
