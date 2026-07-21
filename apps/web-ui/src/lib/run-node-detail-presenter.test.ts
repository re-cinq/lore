import { describe, it, expect } from "vitest";
import { describeNode } from "./run-node-detail-presenter";
import { implementationDefinition } from "./builtin-definitions";
import type { AssemblyLineRunNode } from "./assembly-line-runs";
import type { NodeRunState } from "./run-event-reducer";
import type { RunStreamEvent } from "./run-stream-types";

const row = (over: Partial<AssemblyLineRunNode> = {}): AssemblyLineRunNode => ({
  nodeId: "implement",
  iteration: 1,
  outcome: "success",
  agentCrName: "cr-1",
  commitSha: "deadbeefcafe",
  durationSeconds: 96,
  ...over,
});

const event = (over: Partial<RunStreamEvent> = {}): RunStreamEvent => ({
  id: "1",
  taskId: "t",
  agentCrName: "cr-1",
  assemblyLineId: "al",
  nodeId: "implement",
  iteration: 1,
  eventType: "message",
  toolName: null,
  toolUseId: null,
  isError: false,
  filePaths: [],
  summary: null,
  payload: {},
  createdAt: "2026-07-14T10:00:00Z",
  ...over,
});

const state = (over: Partial<NodeRunState> = {}): NodeRunState => ({
  status: "succeeded",
  iteration: 1,
  transcript: [],
  droppedCount: 0,
  ...over,
});

describe("describeNode", () => {
  it("explains a succeeded node with its type, outcome and duration", () => {
    const detail = describeNode({
      nodeId: "implement",
      state: state(),
      row: row(),
      definition: implementationDefinition,
      reason: null,
    });

    expect(detail).toMatchObject({ tone: "ok", statusLabel: "Succeeded" });
    expect(detail.why).toBe(
      "Ran the agent node and emitted success in 1m 36s.",
    );
  });

  it("uses the last errored result summary as the failure why", () => {
    const detail = describeNode({
      nodeId: "implement",
      state: state({
        status: "failed",
        transcript: [
          event({
            eventType: "result",
            isError: true,
            summary: "eslint failed",
          }),
        ],
      }),
      row: row({ outcome: "implement-failed" }),
      definition: implementationDefinition,
      reason: "run reason",
    });

    expect(detail.why).toBe("Failed: eslint failed.");
  });

  it("falls back to the run reason when no errored result carries a summary", () => {
    const detail = describeNode({
      nodeId: "implement",
      state: state({ status: "failed" }),
      row: row({ outcome: "implement-failed" }),
      definition: implementationDefinition,
      reason: "pod exited non-zero",
    });

    expect(detail.why).toBe("Failed: pod exited non-zero.");
  });

  it("marks an idle terminal node as a terminal marker", () => {
    const detail = describeNode({
      nodeId: "done",
      state: undefined,
      row: undefined,
      definition: implementationDefinition,
      reason: null,
    });

    expect(detail).toMatchObject({ statusLabel: "Terminal" });
    expect(detail.why).toBe("Terminal marker — the run ends here.");
  });

  it("explains an idle non-terminal node as not reached", () => {
    const detail = describeNode({
      nodeId: "review",
      state: undefined,
      row: undefined,
      definition: implementationDefinition,
      reason: null,
    });

    expect(detail.why).toBe(
      "Not reached — the run finished along another branch before it ran.",
    );
  });

  it("collects the unique files touched across the transcript", () => {
    const detail = describeNode({
      nodeId: "implement",
      state: state({
        transcript: [
          event({ filePaths: ["a.ts", "b.ts"] }),
          event({ id: "2", filePaths: ["a.ts", "c.ts"] }),
        ],
      }),
      row: row(),
      definition: implementationDefinition,
      reason: null,
    });

    expect(detail.files).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("reports the transcript event count and dropped overflow", () => {
    const detail = describeNode({
      nodeId: "implement",
      state: state({
        transcript: [event(), event({ id: "2" })],
        droppedCount: 3,
      }),
      row: row(),
      definition: implementationDefinition,
      reason: null,
    });

    expect(detail).toMatchObject({ eventCount: 2, droppedCount: 3 });
  });

  it("labels a running node duration running and outcome in progress and keeps its start time", () => {
    const detail = describeNode({
      nodeId: "implement",
      state: state({ status: "running" }),
      row: row({
        outcome: null,
        durationSeconds: null,
        startedAt: "2026-07-20T09:39:27Z",
      }),
      definition: implementationDefinition,
      reason: null,
    });

    expect(detail).toMatchObject({
      durationLabel: "running",
      outcomeLabel: "in progress",
      startedAt: "2026-07-20T09:39:27Z",
    });
  });

  it("labels a finished node duration and outcome from the row", () => {
    const detail = describeNode({
      nodeId: "implement",
      state: state(),
      row: row(),
      definition: implementationDefinition,
      reason: null,
    });

    expect(detail).toMatchObject({
      durationLabel: "1m 36s",
      outcomeLabel: "success",
    });
  });
});
