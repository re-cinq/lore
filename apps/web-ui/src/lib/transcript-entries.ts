// The conversation model the terminal transcript renders (run-viz FR4.17–FR4.18): classified turns folded into tool calls with their results, thinking folded away, the node's task transitions interleaved by clock, and one header per visit. Pure — the panel hands in turns and task events, the view draws what comes out.

import type { LogEntry } from "./agent-log-entries";
import type { AssemblyRunNode } from "./assembly-run-rows";
import { formatEnumLabel } from "./enum-label";
import type { TaskRuntimeEvent } from "./task-runtime";

/** One classified entry with the clock of the turn it came from. */
export interface TimedEntry {
  at: string;
  entry: LogEntry;
}

export interface ToolCallResult {
  text: string;
  isError: boolean;
}

export type TranscriptEntry =
  | { kind: "turn"; at: string; entry: LogEntry }
  | {
      kind: "tool-call";
      at: string;
      summary: string;
      /** Null while the call has no result yet — a live run's open call, or a stream that ended mid-call. */
      result: ToolCallResult | null;
    }
  | { kind: "thinking"; at: string; text: string }
  | {
      kind: "task-event";
      at: string;
      label: string;
      metadata: Record<string, unknown> | null;
    }
  | { kind: "segment"; at: string; label: string };

/** The visit's turns, headed by its label when it has one. */
export interface TranscriptSegment {
  label: string | null;
  entries: readonly TimedEntry[];
}

/** A tool result closes the newest call still waiting for one; a result with no open call is just a line. */
function closeOpenCall(
  entries: TranscriptEntry[],
  result: ToolCallResult,
): boolean {
  for (let i = entries.length - 1; i >= 0; i--) {
    const candidate = entries[i];

    if (candidate.kind === "tool-call" && candidate.result === null) {
      entries[i] = { ...candidate, result };

      return true;
    }
  }

  return false;
}

/** A tool result closes the newest open call; one with no open call stays a plain line. */
function foldToolResult(
  entries: TranscriptEntry[],
  at: string,
  entry: Extract<LogEntry, { kind: "tool-result" }>,
): void {
  const result = { text: entry.text, isError: entry.isError };

  if (!closeOpenCall(entries, result)) {
    entries.push({ kind: "turn", at, entry });
  }
}

function foldOne(entries: TranscriptEntry[], { at, entry }: TimedEntry): void {
  if (entry.kind === "tool-use") {
    entries.push({
      kind: "tool-call",
      at,
      summary: entry.summary,
      result: null,
    });

    return;
  }

  if (entry.kind === "tool-result") {
    foldToolResult(entries, at, entry);

    return;
  }
  entries.push(
    entry.kind === "thinking"
      ? { kind: "thinking", at, text: entry.text }
      : { kind: "turn", at, entry },
  );
}

/** Tool uses and their results become one entry each; thinking folds to its own kind; everything else stays a turn. */
export function pairToolCalls(timed: readonly TimedEntry[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];

  timed.forEach((timedEntry) => foldOne(entries, timedEntry));

  return entries;
}

/** Every segment flattened in order, each headed by its label; the header carries the clock of the segment's first entry so a merge keeps it in place. */
export function segmentEntries(
  segments: readonly TranscriptSegment[],
): TranscriptEntry[] {
  return segments.flatMap(({ label, entries }) => {
    const at = entries.length === 0 ? "" : entries[0].at;
    const header: TranscriptEntry[] =
      label === null ? [] : [{ kind: "segment", at, label }];

    return [...header, ...pairToolCalls(entries)];
  });
}

export interface NodeWindow {
  start: string | null;
  /** Null while any visit is still running: the window is open-ended. */
  end: string | null;
}

function endOf(row: AssemblyRunNode): number | null {
  if (!row.startedAt || row.durationSeconds === null) {
    return null;
  }

  return Date.parse(row.startedAt) + row.durationSeconds * 1000;
}

/** The span this node's visits cover: the earliest start to the latest end, open while a visit has not ended. */
export function nodeWindow(rows: readonly AssemblyRunNode[]): NodeWindow {
  const starts = rows.flatMap((row) =>
    row.startedAt ? [Date.parse(row.startedAt)] : [],
  );
  const ends = rows.map(endOf);
  const start = starts.length > 0 ? Math.min(...starts) : null;
  const end =
    rows.length > 0 && ends.every((value) => value !== null)
      ? Math.max(...(ends as number[]))
      : null;

  return {
    start: start === null ? null : new Date(start).toISOString(),
    end: end === null ? null : new Date(end).toISOString(),
  };
}

export function taskEventLabel(from: string | null, to: string): string {
  const arrow = from === null ? "" : `${formatEnumLabel(from)} → `;

  return `task ${arrow}${formatEnumLabel(to)}`;
}

function inWindow(at: string, window: NodeWindow): boolean {
  const time = Date.parse(at);
  const afterStart = window.start === null || time >= Date.parse(window.start);
  const beforeEnd = window.end === null || time <= Date.parse(window.end);

  return afterStart && beforeEnd;
}

/** The task's transitions that fell inside this node's window, as system lines. */
export function taskEventEntries(
  events: readonly TaskRuntimeEvent[],
  window: NodeWindow,
): TranscriptEntry[] {
  return events
    .filter((event) => inWindow(event.created_at, window))
    .map((event) => ({
      kind: "task-event" as const,
      at: event.created_at,
      label: taskEventLabel(event.from_status, event.to_status),
      metadata: event.metadata,
    }));
}

/** One clock order across both sources; a task event at the same instant as an agent entry comes first, because the transition is what the agent's next line responds to. */
export function mergeTranscript(
  agent: readonly TranscriptEntry[],
  task: readonly TranscriptEntry[],
): TranscriptEntry[] {
  const merged: TranscriptEntry[] = [];
  let a = 0;
  let t = 0;

  while (a < agent.length || t < task.length) {
    const takeTask =
      t < task.length &&
      (a >= agent.length || Date.parse(task[t].at) <= Date.parse(agent[a].at));

    merged.push(takeTask ? task[t++] : agent[a++]);
  }

  return merged;
}

/** The second an entry falls in, or NaN when its time cannot be read. */
function secondOf(at: string): number {
  return Math.floor(Date.parse(at) / 1000);
}

/** Which entries print a clock: the first, and any that begins a new second. A burst of turns inside one second is one exchange, and repeating the same time down the left of every line reads as noise rather than as timing. An unreadable time never matches its neighbour, so it always prints. */
export function clockShown(entries: readonly TranscriptEntry[]): boolean[] {
  let previous = Number.NaN;

  return entries.map((entry) => {
    const second = secondOf(entry.at);
    const shown = second !== previous;

    previous = second;

    return shown;
  });
}
