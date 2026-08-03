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

/** The task-page projection of a pipeline.assembly_lines row. */
export interface LiveRunCandidate {
  id: string;
  status: string;
  created_at: string;
}

/**
 * The run worth streaming: the newest non-terminal attempt, or null. Sorts
 * defensively — callers hand over whatever order their query returned.
 */
export function pickLiveRun(runs: readonly LiveRunCandidate[]): string | null {
  const live = runs
    .filter((run) => !isTerminalRunStatus(run.status))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

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

/** Gate for event-triggered refreshes: at most one per EVENT_REFRESH_MIN_GAP_MS. */
export function shouldRefreshOnEvent(
  lastRefreshAtMs: number,
  nowMs: number,
): boolean {
  return nowMs - lastRefreshAtMs >= EVENT_REFRESH_MIN_GAP_MS;
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
 * Whether the coordinator should keep asking /api/tasks/:id/runs for a run to
 * stream from: only while none is attached, some panel still wants data, and
 * the task can still be dispatched. Once a run attaches or the task settles,
 * discovery stops for good.
 */
export function runDiscoveryActive(input: {
  liveRunId: string | null;
  taskStatus: string;
  anyPanelActive: boolean;
}): boolean {
  return (
    input.liveRunId === null &&
    input.anyPanelActive &&
    DISPATCHABLE_TASK_STATUSES.has(input.taskStatus)
  );
}
