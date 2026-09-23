import { describe, it, expect } from "vitest";
import type { AgentRunEvent } from "@re-cinq/lore-shared/models/agent-run-event.js";
import {
  agentEventFrame,
  catchupFrame,
  ciCheckFrame,
  RunStreamFrameSchema,
  runStatusFrame,
  taskEventFrame,
} from "./run-stream-frame.js";

function event(id: string): AgentRunEvent {
  return {
    id,
    taskId: "task-1",
    agentCrName: "05fc5491-implement",
    assemblyLineId: "run-1",
    stationRunId: null,
    nodeId: "implement",
    iteration: 1,
    eventType: "tool_call",
    toolName: "Edit",
    toolUseId: "tu-1",
    isError: false,
    filePaths: ["src/foo.ts"],
    summary: "Edit src/foo.ts",
    payload: {},
    createdAt: new Date("2026-07-20T10:00:00.000Z"),
  };
}

describe("run stream frames", () => {
  it("carries an agent event under its type with the row id the cursor reads", () => {
    expect(agentEventFrame(event("42"))).toMatchObject({
      type: "agent_event",
      event: { id: "42", createdAt: new Date("2026-07-20T10:00:00.000Z") },
    });
  });

  it("serializes createdAt as an ISO string inside the agent event", () => {
    expect(
      JSON.parse(JSON.stringify(agentEventFrame(event("42")))),
    ).toMatchObject({
      event: { id: "42", createdAt: "2026-07-20T10:00:00.000Z" },
    });
  });

  it("frames the run's facts as run_status", () => {
    expect(
      runStatusFrame({
        id: "run-1",
        status: "finished",
        outcome: "success",
        reason: null,
        startedAt: null,
        finishedAt: null,
      } as never),
    ).toEqual({
      type: "run_status",
      run: {
        id: "run-1",
        status: "finished",
        outcome: "success",
        reason: null,
        started_at: null,
        finished_at: null,
      },
    });
  });

  it("frames task events and CI checks under their own types with wire field names", () => {
    const task = taskEventFrame({
      id: "7",
      taskId: "task-1",
      fromStatus: "queued",
      toStatus: "running",
      metadata: null,
      createdAt: new Date("2026-07-20T10:00:00.000Z"),
    });
    const check = ciCheckFrame(
      "o/r",
      12,
      { computed_status: "open" },
      new Date(0),
    );

    expect(task).toMatchObject({
      type: "task_event",
      event: { id: "7", to_status: "running" },
    });
    expect(check).toMatchObject({
      type: "ci_check",
      check: { repo: "o/r", pr_number: 12 },
    });
  });

  it("frames catchup_complete with the last replayed id, and every frame satisfies the published schema", () => {
    const frames = [
      catchupFrame("9"),
      agentEventFrame(event("1")),
      ciCheckFrame("o/r", 12, {}, new Date(0)),
    ];

    expect(frames[0]).toEqual({ type: "catchup_complete", last_id: "9" });
    expect(
      frames.map((f) => RunStreamFrameSchema.safeParse(f).success),
    ).toEqual([true, true, true]);
  });
});
