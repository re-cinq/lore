import { describe, it, expect } from "vitest";
import type { AssemblyRunNode } from "./assembly-run-rows";
import type { TaskRuntimeEvent } from "./task-runtime";
import {
  clockShown,
  mergeTranscript,
  nodeWindow,
  pairToolCalls,
  segmentEntries,
  taskEventEntries,
  taskEventLabel,
  type TimedEntry,
  type TranscriptEntry,
} from "./transcript-entries";

const at = (second: number) =>
  `2026-09-09T10:00:${String(second).padStart(2, "0")}.000Z`;

const timed = (second: number, entry: TimedEntry["entry"]): TimedEntry => ({
  at: at(second),
  entry,
});

describe("pairToolCalls", () => {
  it("folds a tool use and its result into one call, and keeps a call without a result open", () => {
    const entries = pairToolCalls([
      timed(1, { kind: "tool-use", summary: "Read src/a.ts" }),
      timed(2, { kind: "tool-result", text: "contents", isError: false }),
      timed(3, { kind: "tool-use", summary: "Edit src/a.ts" }),
    ]);

    expect(entries).toEqual([
      {
        kind: "tool-call",
        at: at(1),
        summary: "Read src/a.ts",
        result: { text: "contents", isError: false },
      },
      { kind: "tool-call", at: at(3), summary: "Edit src/a.ts", result: null },
    ]);
  });

  it("flags an errored result, folds thinking, and keeps a result with no open call as a plain line", () => {
    const entries = pairToolCalls([
      timed(1, { kind: "thinking", text: "hmm" }),
      timed(2, { kind: "tool-result", text: "stray", isError: true }),
      timed(3, { kind: "tool-use", summary: "Bash npm test" }),
      timed(4, { kind: "tool-result", text: "1 failed", isError: true }),
      timed(5, { kind: "assistant-text", text: "Fixing." }),
    ]);

    expect(entries.map((entry) => entry.kind)).toEqual([
      "thinking",
      "turn",
      "tool-call",
      "turn",
    ]);
    expect(entries[2]).toMatchObject({ result: { isError: true } });
  });
});

describe("segmentEntries", () => {
  it("heads each labelled visit with a segment line carrying its first entry's clock", () => {
    const entries = segmentEntries([
      {
        label: "implement · iteration 1",
        entries: [timed(1, { kind: "assistant-text", text: "hi" })],
      },
      { label: null, entries: [timed(9, { kind: "raw", text: "x" })] },
    ]);

    expect(entries.map((entry) => [entry.kind, entry.at])).toEqual([
      ["segment", at(1)],
      ["turn", at(1)],
      ["turn", at(9)],
    ]);
  });
});

describe("nodeWindow", () => {
  const row = (over: Partial<AssemblyRunNode>): AssemblyRunNode => ({
    nodeId: "implement",
    iteration: 1,
    outcome: "success",
    agentCrName: null,
    commitSha: null,
    durationSeconds: 60,
    startedAt: at(0),
    ...over,
  });

  it("spans the earliest start to the latest end across two attempts", () => {
    expect(
      nodeWindow([row({}), row({ iteration: 2, startedAt: at(30) })]),
    ).toEqual({ start: at(0), end: "2026-09-09T10:01:30.000Z" });
  });

  it("stays open-ended while an attempt is still running, and empty for no rows", () => {
    expect(nodeWindow([row({ durationSeconds: null })])).toEqual({
      start: at(0),
      end: null,
    });
    expect(nodeWindow([])).toEqual({ start: null, end: null });
  });
});

describe("taskEventEntries", () => {
  const event = (second: number, to: string): TaskRuntimeEvent => ({
    id: String(second),
    task_id: "task-1",
    from_status: "running",
    to_status: to,
    metadata: null,
    created_at: at(second),
  });

  it("keeps the transitions inside the window and drops those before it", () => {
    const entries = taskEventEntries(
      [event(1, "queued"), event(5, "pr_created"), event(9, "merged")],
      { start: at(4), end: at(8) },
    );

    expect(entries).toEqual([
      {
        kind: "task-event",
        at: at(5),
        label: taskEventLabel("running", "pr_created"),
        metadata: null,
      },
    ]);
  });

  it("keeps trailing transitions while the window is open-ended", () => {
    const entries = taskEventEntries([event(5, "a"), event(50, "b")], {
      start: at(4),
      end: null,
    });

    expect(entries.map((entry) => entry.at)).toEqual([at(5), at(50)]);
  });

  it("labels a transition with both statuses, and a first transition with only its target", () => {
    expect(taskEventLabel("pending", "running")).toBe("task Pending → Running");
    expect(taskEventLabel(null, "pending")).toBe("task Pending");
  });
});

describe("mergeTranscript", () => {
  const turn = (second: number): TranscriptEntry => ({
    kind: "turn",
    at: at(second),
    entry: { kind: "raw", text: `t${second}` },
  });
  const task = (second: number): TranscriptEntry => ({
    kind: "task-event",
    at: at(second),
    label: `e${second}`,
    metadata: null,
  });

  it("interleaves by clock, stably, with a task event first on a tie", () => {
    const merged = mergeTranscript(
      [turn(1), turn(5), turn(9)],
      [task(5), task(7)],
    );

    expect(merged.map((entry) => [entry.kind, entry.at])).toEqual([
      ["turn", at(1)],
      ["task-event", at(5)],
      ["turn", at(5)],
      ["task-event", at(7)],
      ["turn", at(9)],
    ]);
  });
});

describe("clockShown", () => {
  const turnAt = (iso: string): TranscriptEntry => ({
    kind: "turn",
    at: iso,
    entry: { kind: "assistant-text", text: "hi" },
  });

  it("shows the clock once for a run of entries sharing one second", () => {
    expect(
      clockShown([turnAt(at(1)), turnAt(at(1)), turnAt(at(2)), turnAt(at(2))]),
    ).toEqual([true, false, true, false]);
  });

  it("shows the clock again when a later entry returns to an earlier second", () => {
    expect(clockShown([turnAt(at(3)), turnAt(at(4)), turnAt(at(3))])).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("shows the clock for every entry whose time cannot be read", () => {
    expect(clockShown([turnAt("not-a-time"), turnAt("not-a-time")])).toEqual([
      true,
      true,
    ]);
  });
});
