// Shapes the reducer's raw per-node RunStreamEvents into rendered transcript
// rows. Pure, and deliberately separate from run-event-reducer.ts: the reducer
// stores events because replay and live share it (spec FR4.6a), and row shaping
// is a render concern that must not change the state those tests pin.

import { clip } from "./agent-log-entries";
import type { RunStreamEvent } from "./run-stream-types";

/** The write path's payload-truncation suffix (floor agent-run-events.ts). */
const TRUNCATION_MARKER = /…\[truncated, \d+ bytes\]$/;

const SUMMARY_MAX = 140;

export type TranscriptRow =
  | { kind: "init"; seq: string; ts: string; iteration: number }
  | { kind: "message"; seq: string; ts: string; text: string }
  | {
      kind: "tool_call";
      seq: string;
      ts: string;
      tool: string;
      summary: string;
    }
  | {
      kind: "tool_result";
      seq: string;
      ts: string;
      tool: string | null;
      summary: string;
      detail: string;
      isError: boolean;
      truncated: boolean;
    }
  | { kind: "result"; seq: string; ts: string; text: string; isError: boolean }
  | { kind: "iteration"; iteration: number }
  | {
      kind: "input";
      iteration: number;
      summary: string;
      description: string;
      prompt: string | null;
      params: readonly (readonly [string, string])[];
      repo: string;
      ref: string;
      truncated: boolean;
    };

/** One visit's recorded input, as the panel hands it to the fold. */
export interface NodeInputView {
  iteration: number;
  description: string;
  prompt: string | null;
  params: Record<string, string> | null;
  repo: string;
  ref: string;
}

function toInputRow(input: NodeInputView): TranscriptRow {
  return {
    kind: "input",
    iteration: input.iteration,
    summary: clip(input.description, SUMMARY_MAX),
    description: input.description,
    prompt: input.prompt,
    params: Object.entries(input.params ?? {}),
    repo: input.repo,
    ref: input.ref,
    // Same marker the write path leaves on a capped tool payload, so a capped
    // input wears the badge the reader already knows.
    truncated:
      TRUNCATION_MARKER.test(input.description) ||
      TRUNCATION_MARKER.test(input.prompt ?? ""),
  };
}

function payloadContent(payload: Record<string, unknown>): string {
  return typeof payload.content === "string" ? payload.content : "";
}

/**
 * One event as one row, or null for an event with nothing to show. `thinking` is
 * dropped: the filed issue's default is skip, signal over noise.
 *
 * A tool_result's `tool` is always null here — an event alone cannot know which
 * call it answers. toTranscriptRows resolves it from the preceding tool_call.
 */
export function toTranscriptRow(event: RunStreamEvent): TranscriptRow | null {
  const seq = event.id;
  const ts = event.createdAt;

  if (event.eventType === "init") {
    return { kind: "init", seq, ts, iteration: event.iteration ?? 1 };
  }

  if (event.eventType === "message") {
    return { kind: "message", seq, ts, text: clip(event.summary ?? "", 2000) };
  }

  if (event.eventType === "tool_call") {
    return {
      kind: "tool_call",
      seq,
      ts,
      tool: event.toolName ?? "tool",
      summary: clip(event.summary ?? "", SUMMARY_MAX),
    };
  }

  if (event.eventType === "tool_result") {
    const detail = payloadContent(event.payload);

    return {
      kind: "tool_result",
      seq,
      ts,
      tool: null,
      summary: clip(event.summary ?? detail, SUMMARY_MAX),
      detail,
      isError: event.isError,
      truncated: TRUNCATION_MARKER.test(detail),
    };
  }

  if (event.eventType === "result") {
    return {
      kind: "result",
      seq,
      ts,
      text: clip(event.summary ?? payloadContent(event.payload), SUMMARY_MAX),
      isError: event.isError,
    };
  }

  return null;
}

/**
 * The whole per-node transcript as rows, with the two things a single event
 * cannot supply: an iteration divider when the node re-enters, and each
 * tool_result's originating tool name.
 *
 * A divider is emitted only when an init raises the iteration above one already
 * seen, so a transcript never opens with a divider above its first row.
 */
export function toTranscriptRows(
  events: readonly RunStreamEvent[],
  inputs: readonly NodeInputView[] = [],
): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  const toolNames = new Map<string, string>();
  let iteration: number | null = null;
  // What the node was GIVEN leads what it then said. The events alone cannot
  // supply it — the pod never echoes its own prompt — so it arrives as state.
  const byIteration = new Map(inputs.map((i) => [i.iteration, i]));
  const shown = new Set<number>();
  const emitInput = (n: number) => {
    const input = byIteration.get(n);

    if (input && !shown.has(n)) {
      shown.add(n);
      rows.push(toInputRow(input));
    }
  };

  emitInput([...byIteration.keys()].sort((a, b) => a - b)[0] ?? -1);

  for (const event of events) {
    const row = toTranscriptRow(event);

    if (row === null) {
      continue;
    }

    if (row.kind === "init") {
      if (iteration !== null && row.iteration > iteration) {
        rows.push({ kind: "iteration", iteration: row.iteration });
      }
      iteration = row.iteration;
      // A revisit's brief belongs under its divider, not at the top of a
      // transcript whose earlier rounds ran on something else.
      emitInput(row.iteration);
    }

    if (row.kind === "tool_call" && event.toolUseId !== null) {
      toolNames.set(event.toolUseId, row.tool);
    }

    rows.push(
      row.kind === "tool_result" && event.toolUseId !== null
        ? { ...row, tool: toolNames.get(event.toolUseId) ?? null }
        : row,
    );
  }

  // A visit whose pod has not spoken yet still has a brief to show — the case the
  // whole feature exists for: dispatched, pending, and previously indistinguishable
  // from a node nobody had started.
  for (const n of [...byIteration.keys()].sort((a, b) => a - b)) {
    emitInput(n);
  }

  return rows;
}
