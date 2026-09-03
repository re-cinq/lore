// Groups turns into node visits; shared by both transcript surfaces (task + run pages).

import type { AgentRunTurn } from "@/lib/run-turn-types";

/** Consecutive turns from one node visit (segment boundary where heading goes). */
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

/** Segment as NDJSON blob (one envelope per line). */
export function segmentRawLog(segment: TurnSegment): string {
  return segment.turns.map((turn) => JSON.stringify(turn.envelope)).join("\n");
}
