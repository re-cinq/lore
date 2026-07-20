// Every decision the live-run panel makes, as pure functions. The panel and the
// EventSource hook are IO shells around this file: they open sockets and set
// state, they do not choose. Same split as node-pod-logs-presenter next door.

/** Matches the Floor's DEFAULT_LIMIT (agent-events-history.ts). */
export const HISTORY_PAGE_LIMIT = 1000;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_CAP_MS = 30000;

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

/** Exponential backoff, capped. Belt to the browser's own EventSource retry. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(
    RECONNECT_CAP_MS,
    RECONNECT_BASE_MS * 2 ** Math.max(0, attempt - 1),
  );
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
