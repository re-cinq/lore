// Pure time-positioning helpers behind the run timeline. `now` is never read
// here — a live run's moving right bound is passed in by the container, so these
// stay deterministic and testable. The reducer's timeline is lifecycle-only
// (init / result), so a tick's wall-clock gap to the `now` edge is what makes a
// stalled node visible without a per-tool event stream.

import type { AgentRunEventType } from "./run-stream-types";
import type { TimelineEntry } from "./run-event-reducer";

export interface TimelineBounds {
  start: string;
  end: string;
}

export type TimelineTone = "start" | "finish" | "neutral";

/** Where `ts` sits in `[startTs, endTs]`, clamped to 0..1. Zero when the span is empty. */
export function timeToFraction(
  ts: string,
  startTs: string,
  endTs: string,
): number {
  const start = Date.parse(startTs);
  const end = Date.parse(endTs);

  if (!(end > start)) {
    return 0;
  }

  const fraction = (Date.parse(ts) - start) / (end - start);

  if (fraction < 0) {
    return 0;
  }

  return fraction > 1 ? 1 : fraction;
}

/**
 * The `[start, end]` a run's ticks are drawn across. `now` is always the right
 * bound so a live run's rail grows rightward; the left bound is the run's start
 * when known, else the earliest tick, else `now` for a run with no ticks yet.
 */
export function timelineBounds(
  ticks: readonly TimelineEntry[],
  runStartedAt: string | null,
  now: string,
): TimelineBounds {
  if (runStartedAt !== null) {
    return { start: runStartedAt, end: now };
  }

  if (ticks.length === 0) {
    return { start: now, end: now };
  }

  const earliest = ticks.reduce(
    (min, tick) => (tick.createdAt < min ? tick.createdAt : min),
    ticks[0].createdAt,
  );

  return { start: earliest, end: now };
}

/** The tone a tick draws in, by event type. Only init and result reach the timeline. */
export function eventTone(eventType: AgentRunEventType): TimelineTone {
  if (eventType === "init") {
    return "start";
  }

  return eventType === "result" ? "finish" : "neutral";
}
