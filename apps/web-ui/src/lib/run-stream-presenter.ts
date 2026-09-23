// Every decision the live-run panel makes, as pure functions — the panel and the channel hook are IO shells that open channels and set state, never choose.

/** Matches the Floor's DEFAULT_LIMIT (agent-events-history.ts). */
export const HISTORY_PAGE_LIMIT = 1000;

export {
  reconnectAction,
  reconnectDelayMs,
  STREAM_MAX_ATTEMPTS,
  type ReconnectAction,
} from "./live-socket/backoff";

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

export function isTerminalRunStatus(status: string): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

// A short page is the only end-of-history signal the REST endpoint gives (no `hasMore` flag), so an exactly-full page always costs one empty request more.
export function nextPageCursor(page: readonly { id: string }[]): string | null {
  return page.length < HISTORY_PAGE_LIMIT
    ? null
    : (page[page.length - 1]?.id ?? null);
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

// One degradation gate — a terminal run, no live socket, or a channel the server would not open all collapse to the same answer, so there's one no-live-stream path.
export function resolveStreamMode(input: {
  runStatus: string;
  socketAvailable: boolean;
  streamUnavailable: boolean;
}): StreamMode {
  if (
    !input.socketAvailable ||
    input.streamUnavailable ||
    isTerminalRunStatus(input.runStatus)
  ) {
    return "history-only";
  }

  return "live";
}
