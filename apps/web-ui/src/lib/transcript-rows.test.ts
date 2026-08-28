import { describe, it, expect } from "vitest";
import { toTranscriptRow, toTranscriptRows } from "./transcript-rows";
import type { NodeInputView } from "./transcript-rows";
import type { RunStreamEvent } from "./run-stream-types";

function event(over: Partial<RunStreamEvent> = {}): RunStreamEvent {
  return {
    id: "1",
    taskId: "task-1",
    agentCrName: null,
    assemblyLineId: "run-1",
    stationRunId: null,
    nodeId: "implement",
    iteration: 1,
    eventType: "message",
    toolName: null,
    toolUseId: null,
    isError: false,
    filePaths: [],
    summary: null,
    payload: {},
    createdAt: "2026-07-20T10:00:00.000Z",
    ...over,
  };
}

describe("toTranscriptRow", () => {
  it("maps a tool_call event to a row carrying the tool name and clipped summary", () => {
    const row = toTranscriptRow(
      event({
        eventType: "tool_call",
        toolName: "Edit",
        summary: `apps/web-ui/${"x".repeat(200)}.ts`,
      }),
    );

    expect(row).toMatchObject({ kind: "tool_call", tool: "Edit", seq: "1" });
    expect(row?.kind === "tool_call" && row.summary.endsWith("…")).toBe(true);
  });

  it("maps a tool_call event with no toolName to a row naming the tool tool", () => {
    const row = toTranscriptRow(event({ eventType: "tool_call" }));

    expect(row).toMatchObject({ kind: "tool_call", tool: "tool", summary: "" });
  });

  it("maps a tool_result event to a row carrying isError true", () => {
    const row = toTranscriptRow(
      event({
        eventType: "tool_result",
        isError: true,
        payload: { content: "ENOENT: no such file" },
      }),
    );

    expect(row).toMatchObject({
      kind: "tool_result",
      isError: true,
      detail: "ENOENT: no such file",
      truncated: false,
    });
  });

  it("maps a message event to a message row with the summary text", () => {
    const row = toTranscriptRow(
      event({ eventType: "message", summary: "Reading the spec" }),
    );

    expect(row).toEqual({
      kind: "message",
      seq: "1",
      ts: "2026-07-20T10:00:00.000Z",
      text: "Reading the spec",
    });
  });

  it("maps an init event to an init row carrying its iteration", () => {
    const row = toTranscriptRow(event({ eventType: "init", iteration: 3 }));

    expect(row).toMatchObject({ kind: "init", iteration: 3 });
  });

  it("maps an init event with a null iteration to iteration 1", () => {
    const row = toTranscriptRow(event({ eventType: "init", iteration: null }));

    expect(row).toMatchObject({ kind: "init", iteration: 1 });
  });

  it("maps a result event to a result row", () => {
    const row = toTranscriptRow(
      event({ eventType: "result", isError: true, summary: "exit 1" }),
    );

    expect(row).toMatchObject({
      kind: "result",
      isError: true,
      text: "exit 1",
    });
  });

  it("returns null for a thinking event", () => {
    expect(toTranscriptRow(event({ eventType: "thinking" }))).toBeNull();
  });

  it("marks a tool_result row whose payload content ends in the write-path truncation marker", () => {
    const row = toTranscriptRow(
      event({
        eventType: "tool_result",
        payload: { content: `${"x".repeat(20)}…[truncated, 4096 bytes]` },
      }),
    );

    expect(row).toMatchObject({ kind: "tool_result", truncated: true });
  });

  it("falls back to the payload content when a tool_result carries no summary", () => {
    const row = toTranscriptRow(
      event({ eventType: "tool_result", payload: { content: "  ok  " } }),
    );

    expect(row).toMatchObject({ summary: "ok", detail: "  ok  " });
  });

  it("maps a tool_result with a non-string payload content to an empty detail", () => {
    const row = toTranscriptRow(
      event({ eventType: "tool_result", payload: { content: { a: 1 } } }),
    );

    expect(row).toMatchObject({ kind: "tool_result", detail: "", summary: "" });
  });
});

describe("toTranscriptRows", () => {
  it("pairs a tool_result to its tool_call by toolUseId", () => {
    const rows = toTranscriptRows([
      event({
        id: "1",
        eventType: "tool_call",
        toolName: "Bash",
        toolUseId: "tu_1",
      }),
      event({ id: "2", eventType: "tool_result", toolUseId: "tu_1" }),
    ]);

    expect(rows[1]).toMatchObject({ kind: "tool_result", tool: "Bash" });
  });

  it("keeps a tool_result row whose toolUseId matches no preceding tool_call", () => {
    const rows = toTranscriptRows([
      event({ id: "2", eventType: "tool_result", toolUseId: "tu_missing" }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "tool_result", tool: null });
  });

  it("inserts an iteration divider when an init event raises the iteration", () => {
    const rows = toTranscriptRows([
      event({ id: "1", eventType: "init", iteration: 1 }),
      event({ id: "2", eventType: "init", iteration: 2 }),
    ]);

    expect(rows.map((row) => row.kind)).toEqual(["init", "iteration", "init"]);
    expect(rows[1]).toEqual({ kind: "iteration", iteration: 2 });
  });

  it("inserts no divider for a transcript that stays on one iteration", () => {
    const rows = toTranscriptRows([
      event({ id: "1", eventType: "init", iteration: 1 }),
      event({ id: "2", eventType: "message", summary: "hi" }),
    ]);

    expect(rows.map((row) => row.kind)).toEqual(["init", "message"]);
  });

  it("inserts no leading divider before the first init of a transcript", () => {
    const rows = toTranscriptRows([
      event({ id: "1", eventType: "init", iteration: 2 }),
    ]);

    expect(rows.map((row) => row.kind)).toEqual(["init"]);
  });

  it("drops thinking events from the folded rows", () => {
    const rows = toTranscriptRows([
      event({ id: "1", eventType: "thinking" }),
      event({ id: "2", eventType: "message", summary: "hi" }),
    ]);

    expect(rows.map((row) => row.kind)).toEqual(["message"]);
  });

  it("returns no rows for an empty event list", () => {
    expect(toTranscriptRows([])).toEqual([]);
  });
});

describe("the transcript opens with what the node was GIVEN", () => {
  const input = (iteration: number, over: Partial<NodeInputView> = {}) => ({
    iteration,
    description: `brief ${iteration}`,
    prompt: `prompt ${iteration}`,
    params: null,
    repo: "o/r",
    ref: "feat/x",
    ...over,
  });

  it("puts the node's input before every event row", () => {
    const rows = toTranscriptRows(
      [event({ id: "1", eventType: "message" })],
      [input(1)],
    );

    expect(rows[0]).toMatchObject({ kind: "input", iteration: 1 });
    expect(rows[1]).toMatchObject({ kind: "message" });
  });

  it("renders only the input row for a visit that has produced no events yet", () => {
    // The headline case: dispatched, pod still pending. Before this the panel
    // showed "No agent events" over a node that had been handed a full brief.
    expect(toTranscriptRows([], [input(1)])).toEqual([
      expect.objectContaining({ kind: "input", iteration: 1 }),
    ]);
  });

  it("places a revisit's input directly after its iteration divider", () => {
    const rows = toTranscriptRows(
      [
        event({ id: "1", eventType: "init", iteration: 1 }),
        event({ id: "2", eventType: "init", iteration: 2 }),
      ],
      [input(1), input(2)],
    );
    const kinds = rows.map(
      (r) => `${r.kind}:${"iteration" in r ? r.iteration : ""}`,
    );

    expect(kinds).toEqual([
      "input:1",
      "init:1",
      "iteration:2",
      "input:2",
      "init:2",
    ]);
  });

  it("appends the input of an iteration whose events have not arrived yet", () => {
    const rows = toTranscriptRows(
      [event({ id: "1", eventType: "init", iteration: 1 })],
      [input(1), input(2)],
    );

    expect(rows[rows.length - 1]).toMatchObject({
      kind: "input",
      iteration: 2,
    });
  });

  it("emits no input row when the visit predates input recording", () => {
    expect(
      toTranscriptRows([event({ id: "1", eventType: "message" })], []),
    ).toEqual(toTranscriptRows([event({ id: "1", eventType: "message" })]));
  });

  it("marks an input whose stored prompt or description was truncated", () => {
    const rows = toTranscriptRows(
      [],
      [input(1, { prompt: "p…[truncated, 20000 bytes]" })],
    );

    expect(rows[0]).toMatchObject({ kind: "input", truncated: true });
    expect(toTranscriptRows([], [input(2)])[0]).toMatchObject({
      truncated: false,
    });
  });

  it("summarises the input by its description head", () => {
    const rows = toTranscriptRows(
      [],
      [input(1, { description: "x".repeat(300) })],
    );

    expect((rows[0] as { summary: string }).summary.length).toBeLessThan(300);
  });
});

describe("hook rows", () => {
  it("renders a finished hook with its name and outcome", () => {
    expect(
      toTranscriptRow(
        event({
          id: "7",
          eventType: "hook",
          summary: "hook SessionStart:startup success",
          payload: {
            hookEvent: "SessionStart",
            outcome: "success",
            exitCode: 0,
          },
        }),
      ),
    ).toEqual({
      kind: "hook",
      seq: "7",
      ts: "2026-07-20T10:00:00.000Z",
      name: "SessionStart",
      summary: "hook SessionStart:startup success",
      isError: false,
    });
  });

  it("falls back to 'hook' when the row carries no hook event name", () => {
    expect(
      toTranscriptRow(event({ eventType: "hook", summary: "hook x blocked" })),
    ).toMatchObject({ name: "hook", isError: false });
  });

  it("carries the error flag of a hook that exited non-zero", () => {
    expect(
      toTranscriptRow(
        event({ eventType: "hook", isError: true, summary: "hook x blocked" }),
      ),
    ).toMatchObject({ kind: "hook", isError: true });
  });
});
