// Every decision the live-run panel makes, as pure functions. The panel and the
// EventSource hook are IO shells around this file: they open sockets and set
// state, they do not choose. Same split as node-pod-logs-presenter next door.

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

export type StreamMode = "live" | "history-only";

export function historyUrl(runId: string, afterId: string): string {
  const base = `/api/assembly-lines/${encodeURIComponent(
    runId,
  )}/events?limit=${HISTORY_PAGE_LIMIT}`;

  return afterId === "0"
    ? base
    : `${base}&after=${encodeURIComponent(afterId)}`;
}

export function streamUrl(runId: string, afterId: string): string {
  const base = `/api/assembly-lines/${encodeURIComponent(runId)}/events/stream`;

  return afterId === "0"
    ? base
    : `${base}?after=${encodeURIComponent(afterId)}`;
}

export function isTerminalRunStatus(status: string): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

/**
 * The cursor to request next, or null when the history is drained. A short page
 * is the only end-of-history signal the REST endpoint gives — it has no
 * `hasMore` flag — so a page that exactly fills the limit always costs one more
 * request that comes back empty.
 */
export function nextPageCursor(page: readonly { id: string }[]): string | null {
  return page.length < HISTORY_PAGE_LIMIT
    ? null
    : (page[page.length - 1]?.id ?? null);
}

/**
 * The scrub cursor that INCLUDES the event with `id`. `replayTo` folds the first
 * `cursor` events (a slice length), so an event at index i is applied at cursor
 * i + 1 — the timeline hands the panel a string id, not an index, so the mapping
 * lives here rather than at the call site. Null when no event carries that id.
 */
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

/**
 * The read-out for a scrub cursor: how many of how many events are applied, and
 * the wall-clock time of the last applied event so the position reads as a
 * moment in the run rather than a bare index. The cursor is clamped into
 * `[0, events.length]` so an out-of-range value from a drag never indexes off
 * the ends.
 */
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

/**
 * What the stream hook does with consecutive failure number `attempt`: retry
 * with backoff up to STREAM_MAX_ATTEMPTS, then give up for good. Giving up is
 * terminal for the session — EventSource cannot read the proxy's status code,
 * so a bounded attempt count is the only thing standing between a stream-only
 * outage and a browser retrying forever. A successful open resets the count,
 * so only consecutive failures walk toward the cliff.
 */
export function reconnectAction(attempt: number): ReconnectAction {
  return attempt > STREAM_MAX_ATTEMPTS
    ? { kind: "give-up" }
    : { kind: "retry", delayMs: reconnectDelayMs(attempt) };
}

export function connectionLabel(state: ConnectionState): string {
  switch (state) {
    case "live":
      return "Live";
    case "connecting":
      return "Connecting";
    case "reconnecting":
      return "Reconnecting";
    default:
      return "Offline";
  }
}

/**
 * The one degradation gate. A terminal run, a browser without EventSource, and
 * a stream proxy that answered 404/503 all collapse to the same answer, so the
 * panel has exactly one no-live-stream path to render and to test rather than
 * three near-identical ones.
 */
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
