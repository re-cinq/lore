// Every decision the live-run panel makes, as pure functions — the panel/EventSource hook are IO shells that open sockets and set state, never choose.
import type { RunStreamEvent } from "@/lib/run-stream-types";

/** Matches the Floor's DEFAULT_LIMIT (agent-events-history.ts). */
export const HISTORY_PAGE_LIMIT = 1000;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_CAP_MS = 30000;

/** Consecutive stream failures tolerated before the session gives up on SSE. */
export const STREAM_MAX_ATTEMPTS = 5;

/** Cadence of the history-poll fallback once the stream has given up. */
export const HISTORY_POLL_MS = 15000;

/** `queued` and `running` can still emit; `finished` and `failed` cannot. */
const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set([
  "finished",
  "failed",
]);

export type ConnectionState =
  "connecting" | "live" | "reconnecting" | "offline";

// Stream states plus "polling" (degraded-but-advancing history-poll fallback), distinct from "offline" so a dead view reads differently.
export type ChipState = ConnectionState | "polling";

export type StreamMode = "live" | "history-only";

export function historyUrl(runId: string, afterId: string): string {
  const base = `/api/assembly-runs/${encodeURIComponent(
    runId,
  )}/events?limit=${HISTORY_PAGE_LIMIT}`;

  return afterId === "0"
    ? base
    : `${base}&after=${encodeURIComponent(afterId)}`;
}

export function streamUrl(runId: string, afterId: string): string {
  const base = `/api/assembly-runs/${encodeURIComponent(runId)}/events/stream`;

  return afterId === "0"
    ? base
    : `${base}?after=${encodeURIComponent(afterId)}`;
}

export function isTerminalRunStatus(status: string): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

// A short page is the only end-of-history signal the REST endpoint gives (no `hasMore` flag), so an exactly-full page always costs one empty request more.
export function nextPageCursor(page: readonly { id: string }[]): string | null {
  return page.length < HISTORY_PAGE_LIMIT
    ? null
    : (page[page.length - 1]?.id ?? null);
}

// The scrub cursor that INCLUDES the event with `id` (replayTo folds a slice length, so index i applies at cursor i+1); null when no event carries that id.
export function cursorForEventId(
  events: readonly RunStreamEvent[],
  id: string,
): number | null {
  const index = events.findIndex((event) => event.id === id);

  return index === -1 ? null : index + 1;
}

export interface ScrubberPosition {
  label: string;
  timestamp: string | null;
}

// Read-out for a scrub cursor: N of M events applied plus the last one's wall-clock time; clamped into [0, events.length] against off-range drags.
export function scrubberPositionLabel(
  events: readonly RunStreamEvent[],
  cursor: number,
): ScrubberPosition {
  const total = events.length;
  const clamped = Math.max(0, Math.min(cursor, total));
  const last = clamped > 0 ? events[clamped - 1] : null;

  return {
    label: `event ${clamped} / ${total}`,
    timestamp: last ? last.createdAt : null,
  };
}

/** Exponential backoff, capped. Belt to the browser's own EventSource retry. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(
    RECONNECT_CAP_MS,
    RECONNECT_BASE_MS * 2 ** Math.max(0, attempt - 1),
  );
}

export type ReconnectAction =
  { kind: "retry"; delayMs: number } | { kind: "give-up" };

// Retries with backoff up to STREAM_MAX_ATTEMPTS then gives up for good — EventSource can't read the proxy's status, so a bounded count stops a forever-retry.
export function reconnectAction(attempt: number): ReconnectAction {
  return attempt > STREAM_MAX_ATTEMPTS
    ? { kind: "give-up" }
    : { kind: "retry", delayMs: reconnectDelayMs(attempt) };
}

export function connectionLabel(state: ChipState): string {
  switch (state) {
    case "live":
      return "Live";
    case "connecting":
      return "Connecting";
    case "reconnecting":
      return "Reconnecting";
    case "polling":
      return "Polling";
    default:
      return "Offline";
  }
}

// An active history-poll fallback reads "polling"; without it history-only mode presents as offline, and live mode passes the hook's own state through.
export function resolveChipState(input: {
  mode: StreamMode;
  connection: ConnectionState;
  fallbackPollActive: boolean;
}): ChipState {
  if (input.fallbackPollActive) {
    return "polling";
  }

  if (input.mode === "history-only" && input.connection !== "offline") {
    return "offline";
  }

  return input.connection;
}

// One degradation gate — a terminal run, no EventSource, or a 404/503 stream proxy all collapse to the same answer, so there's one no-live-stream path.
export function resolveStreamMode(input: {
  runStatus: string;
  eventSourceAvailable: boolean;
  streamUnavailable: boolean;
}): StreamMode {
  if (
    !input.eventSourceAvailable ||
    input.streamUnavailable ||
    isTerminalRunStatus(input.runStatus)
  ) {
    return "history-only";
  }

  return "live";
}
