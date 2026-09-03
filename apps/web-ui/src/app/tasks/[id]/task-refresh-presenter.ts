// Pure functions for coordinated refresh decisions.

import {
  isTerminalRunStatus,
  type ConnectionState,
} from "@/app/assembly-runs/[id]/run-stream-presenter";

/** The one coordinated cadence that replaced the panels' 5s/10s/15s intervals. */
export const COORDINATED_POLL_MS = 10_000;

/** Heartbeat poll interval while stream is live. */
export const STREAM_HEARTBEAT_POLL_MS = 30_000;

/** Min gap between event-triggered refreshes; absorbs the catch-up replay burst. */
export const EVENT_REFRESH_MIN_GAP_MS = 3_000;

/** Task-page projection of a pipeline.assembly_runs row. */
export interface LiveRunCandidate {
  id: string;
  status: string;
  created_at: string | Date;
}

/** Newest non-terminal attempt, or null. */
export function pickLiveRun(runs: readonly LiveRunCandidate[]): string | null {
  const live = runs
    .filter((run) => !isTerminalRunStatus(run.status))
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

  return live[0]?.id ?? null;
}

export type RefreshDriver = "stream" | "poll" | "idle";

/** What advances the page: stream/poll/idle. */
export function resolveRefreshDriver(input: {
  liveRunId: string | null;
  eventSourceAvailable: boolean;
  streamUnavailable: boolean;
  anyPanelActive: boolean;
}): RefreshDriver {
  if (!input.anyPanelActive) {
    return "idle";
  }

  if (
    input.liveRunId === null ||
    !input.eventSourceAvailable ||
    input.streamUnavailable
  ) {
    return "poll";
  }

  return "stream";
}

/** Interval cadence, or null for no interval. */
export function refreshIntervalMs(
  driver: RefreshDriver,
  connection: ConnectionState,
): number | null {
  if (driver === "idle") {
    return null;
  }

  if (driver === "stream" && connection === "live") {
    return STREAM_HEARTBEAT_POLL_MS;
  }

  return COORDINATED_POLL_MS;
}

/** Event-triggered refresh delay: 0 means refresh now. */
export function eventRefreshDelayMs(
  lastRefreshAtMs: number,
  nowMs: number,
): number {
  return Math.max(0, EVENT_REFRESH_MIN_GAP_MS - (nowMs - lastRefreshAtMs));
}

/** Higher of two numeric event ids, accounting for numeric comparison. */
export function maxEventId(current: string, candidate: string): string {
  try {
    return BigInt(candidate) > BigInt(current) ? candidate : current;
  } catch {
    return current;
  }
}

/** Task statuses that can still mint a new assembly-line run. */
const DISPATCHABLE_TASK_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "queued",
  "running",
  "review",
]);

/** Check /api/tasks/:id/runs on tick; run attached or task dispatchable. */
export function runDiscoveryActive(input: {
  liveRunId: string | null;
  taskStatus: string;
  anyPanelActive: boolean;
}): boolean {
  if (!input.anyPanelActive) {
    return false;
  }

  return (
    input.liveRunId !== null || DISPATCHABLE_TASK_STATUSES.has(input.taskStatus)
  );
}
