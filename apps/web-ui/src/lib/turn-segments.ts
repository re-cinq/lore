// Grouping stored turns into the node visits they belong to. Shared by both
// transcript surfaces — the task page's log viewer and the run page's full
// transcript panel — because "a node revisited at iteration 2 is a new visit"
// is one rule, not one per page.
//
// The segment carries its turns rather than a pre-joined blob: the NDJSON
// projection and the per-turn timed projection are both derivable from them,
// and storing either alongside the turns would be the same knowledge twice.

import type { AgentRunTurn } from "@/lib/run-turn-types";

/**
 * One run of consecutive turns from the same node visit. A task's turns span
 * every node of its assembly line (and every retry), so rendering them as one
 * undifferentiated stream would interleave several session-inits and result
 * footers; the segment boundary is where the heading goes.
 */
export interface TurnSegment {
  nodeId: string | null;
  iteration: number | null;
  turns: AgentRunTurn[];
}

export function segmentTurns(turns: readonly AgentRunTurn[]): TurnSegment[] {
  const segments: TurnSegment[] = [];

  for (const turn of turns) {
    const last = segments[segments.length - 1];

    if (
      last !== undefined &&
      last.nodeId === turn.nodeId &&
      last.iteration === turn.iteration
    ) {
      last.turns.push(turn);
      continue;
    }
    segments.push({
      nodeId: turn.nodeId,
      iteration: turn.iteration,
      turns: [turn],
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

/** The segment as the NDJSON blob `parseAgentLog` consumes — one envelope per
 *  line, in the order the turns were stored. */
export function segmentRawLog(segment: TurnSegment): string {
  return segment.turns.map((turn) => JSON.stringify(turn.envelope)).join("\n");
}
