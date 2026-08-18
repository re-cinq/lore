// Pure helpers behind TaskLogs: URL building, poll-cursor arithmetic, and the
// turn→NDJSON projection the log parser consumes. Split from the component for
// the same reason turn-transcript-presenter is split from FullTranscriptPanel.
//
// Unlike the run page's one-shot walk, the task page polls: the cursor
// persists across coordinator ticks, so advancing it and deciding whether the
// walk continues are separate rules (`advanceCursor` moves on every page,
// full or short; `pageIsFull` alone says whether to keep walking now).

import {
  MAX_TURNS_LOADED,
  TURNS_PAGE_LIMIT,
} from "@/app/assembly-runs/[id]/turn-transcript-presenter";
import type { AgentRunTurn } from "@/lib/run-turn-types";

export function taskLogsUrl(taskId: string, afterId: string): string {
  const base = `/api/tasks/${encodeURIComponent(
    taskId,
  )}/logs?limit=${TURNS_PAGE_LIMIT}`;

  return afterId === "0"
    ? base
    : `${base}&after=${encodeURIComponent(afterId)}`;
}

/**
 * The cursor after consuming `page`: the last row carrying a string id, so one
 * unparseable row cannot stall the poll, or the current cursor when the page
 * has none.
 */
export function advanceCursor(
  page: readonly unknown[],
  current: string,
): string {
  for (let i = page.length - 1; i >= 0; i--) {
    const id = (page[i] as { id?: unknown } | null)?.id;

    if (typeof id === "string") {
      return id;
    }
  }

  return current;
}

/** A full page means more rows may follow — same short-page rule as the run page. */
function pageIsFull(page: readonly unknown[]): boolean {
  return page.length >= TURNS_PAGE_LIMIT;
}

/**
 * Whether the walk fetches another page now: only while pages come back full
 * and the run-page hard cap is not yet reached — untruncated envelopes over an
 * unbounded walk would materialize tens of megabytes in the tab.
 */
export function walkContinues(
  page: readonly unknown[],
  loadedCount: number,
): boolean {
  return pageIsFull(page) && loadedCount < MAX_TURNS_LOADED;
}

/**
 * One run of consecutive turns from the same node visit. A task's turns span
 * every node of its assembly line (and every retry), so rendering them as one
 * undifferentiated stream would interleave several session-inits and result
 * footers; the segment boundary is where the heading goes.
 */
export interface TurnSegment {
  nodeId: string | null;
  iteration: number | null;
  rawLog: string;
}

export function segmentTurns(turns: readonly AgentRunTurn[]): TurnSegment[] {
  const segments: TurnSegment[] = [];

  for (const turn of turns) {
    const last = segments[segments.length - 1];
    const line = JSON.stringify(turn.envelope);

    if (
      last !== undefined &&
      last.nodeId === turn.nodeId &&
      last.iteration === turn.iteration
    ) {
      last.rawLog += `\n${line}`;
      continue;
    }
    segments.push({
      nodeId: turn.nodeId,
      iteration: turn.iteration,
      rawLog: line,
    });
  }

  return segments;
}

export function segmentLabel(segment: TurnSegment): string | null {
  if (segment.nodeId === null) {
    return null;
  }

  return segment.iteration === null
    ? segment.nodeId
    : `${segment.nodeId} · iteration ${segment.iteration}`;
}

/** The stored stream, re-serialized one envelope per line — the Raw view. */
export function turnsToRawLog(turns: readonly AgentRunTurn[]): string {
  return turns.map((turn) => JSON.stringify(turn.envelope)).join("\n");
}
