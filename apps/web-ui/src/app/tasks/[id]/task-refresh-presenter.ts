// Every decision the task page's coordinated refresh makes, as pure functions.
// TaskRefreshProvider is the IO shell around this file — the same split as
// run-stream-presenter on the assembly-lines page, whose stream vocabulary
// (ConnectionState, isTerminalRunStatus) is reused rather than redefined.

import {
  isTerminalRunStatus,
  type ConnectionState,
} from "@/app/assembly-lines/[id]/run-stream-presenter";

/** The one coordinated cadence that replaced the panels' 5s/10s/15s intervals. */
export const COORDINATED_POLL_MS = 10_000;

/**
 * The belt while the stream is live: PR reviews, CI checks, and GCS log flushes
 * change server-side without emitting an agent event, so the page still polls —
 * just slowly, because the stream carries the fast signal.
 */
export const STREAM_HEARTBEAT_POLL_MS = 30_000;

/** Min gap between event-triggered refreshes; absorbs the catch-up replay burst. */
export const EVENT_REFRESH_MIN_GAP_MS = 3_000;

/**
 * The task-page projection of a pipeline.assembly_runs row. `created_at` is a
 * Date when the rows come off the server component's pg query (RSC serializes
 * Date as Date) and a string when they come off the JSON discovery route.
 */
export interface LiveRunCandidate {
  id: string;
  status: string;
  created_at: string | Date;
}

/**
 * The run worth streaming: the newest non-terminal attempt, or null. Sorts
 * defensively — callers hand over whatever order their query returned.
 */
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

/**
 * What advances the page: nothing when no panel wants data; the SSE stream when
 * a live run exists and streaming is possible; a plain poll otherwise.
 */
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

/**
 * The single interval's cadence, or null for no interval at all. A stream that
 * is not yet live (connecting, reconnecting) still polls at the coordinated
 * cadence so a slow handshake never stalls the page.
 */
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

/**
 * How long an event-triggered refresh must wait: 0 means refresh now, a
 * positive delay means schedule a trailing refresh at the window boundary so
 * a burst's final events (typically the outcome writes) never wait for the
 * heartbeat. At most one refresh per EVENT_REFRESH_MIN_GAP_MS either way.
 */
export function eventRefreshDelayMs(
  lastRefreshAtMs: number,
  nowMs: number,
): number {
  return Math.max(0, EVENT_REFRESH_MIN_GAP_MS - (nowMs - lastRefreshAtMs));
}

/**
 * The higher of two numeric event ids — the stream cursor, compared as the
 * Floor compares it (numerically; the ids outgrow neither BigInt nor string,
 * but they do outgrow lexicographic order at every digit rollover). A
 * non-numeric candidate keeps the current cursor.
 */
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

/**
 * Whether the coordinator should check /api/tasks/:id/runs on this tick.
 * While a run is attached the check re-reads its recorded status, so a
 * finished run detaches (back to 10s polling) and a retry's fresh attempt can
 * take its place — a live stream never closes on its own, so without this the
 * attachment would be sticky for the tab's life. Unattached, the check runs
 * only while the task status can still mint a run. No active panel, no check.
 */
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
