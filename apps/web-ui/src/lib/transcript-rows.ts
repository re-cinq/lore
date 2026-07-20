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
  | { kind: "iteration"; iteration: number };

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
): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  const toolNames = new Map<string, string>();
  let iteration: number | null = null;

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

  return rows;
}
