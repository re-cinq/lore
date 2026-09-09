import { describe, it, expect } from "vitest";
import type { AgentRunEvent } from "@re-cinq/lore-shared/models/agent-run-event.js";
import {
  agentEventFrame,
  catchupFrame,
  ciCheckFrame,
  runStatusFrame,
  sseComment,
  sseFrame,
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

describe("sseFrame", () => {
  it("frames an agent event as id, event and data lines terminated by a blank line", () => {
    const lines = sseFrame(agentEventFrame(event("42"))).split("\n");

    expect(lines[0]).toBe("id: 42");
    expect(lines[1]).toBe("event: agent_event");
    expect(lines[2]?.startsWith('data: {"type":"agent_event"')).toBe(true);
    expect(lines.slice(-2)).toEqual(["", ""]);
  });

  it("serializes createdAt as an ISO string inside the agent event", () => {
    const payload = sseFrame(agentEventFrame(event("42")))
      .split("\n")[2]
      ?.slice("data: ".length);

    expect(JSON.parse(payload ?? "{}")).toMatchObject({
      event: { id: "42", createdAt: "2026-07-20T10:00:00.000Z" },
    });
  });

  it("gives a run_status frame no id line, so the browser cursor stays on the agent events", () => {
    const frame = sseFrame(
      runStatusFrame({
        id: "run-1",
        status: "finished",
        outcome: "success",
        reason: null,
        startedAt: null,
        finishedAt: null,
      } as never),
    );

    expect(frame.startsWith("event: run_status\n")).toBe(true);
    expect(frame).not.toContain("id: ");
  });

  it("frames task events and CI checks under their own event names", () => {
    const task = sseFrame(
      taskEventFrame({
        id: "7",
        taskId: "task-1",
        fromStatus: "queued",
        toStatus: "running",
        metadata: null,
        createdAt: new Date("2026-07-20T10:00:00.000Z"),
      }),
    );
    const check = sseFrame(
      ciCheckFrame("o/r", 12, { computed_status: "open" }, new Date(0)),
    );

    expect(task).toContain('event: task_event\ndata: {"type":"task_event"');
    expect(task).toContain('"to_status":"running"');
    expect(check).toContain('event: ci_check\ndata: {"type":"ci_check"');
    expect(check).toContain('"pr_number":12');
  });

  it("frames catchup_complete with the last replayed id", () => {
    expect(sseFrame(catchupFrame("9"))).toBe(
      'event: catchup_complete\ndata: {"type":"catchup_complete","last_id":"9"}\n\n',
    );
  });
});

describe("sseComment", () => {
  it("frames a comment with a leading colon and a blank line", () => {
    expect(sseComment("ping")).toBe(": ping\n\n");
  });
});
