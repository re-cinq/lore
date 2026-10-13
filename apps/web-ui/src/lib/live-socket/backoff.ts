// How long to wait before trying the socket again, and when to stop trying.

const RECONNECT_BASE_MS = 1000;
const RECONNECT_CAP_MS = 30000;

/** Consecutive socket failures tolerated before the client gives up on live delivery. */
export const STREAM_MAX_ATTEMPTS = 5;

/** Exponential backoff, capped. Attempt 1 waits one second, attempt 5 sixteen. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(
    RECONNECT_CAP_MS,
    RECONNECT_BASE_MS * 2 ** Math.max(0, attempt - 1),
  );
}

export type ReconnectAction =
  { kind: "retry"; delayMs: number } | { kind: "give-up" };

/** Retries with backoff up to STREAM_MAX_ATTEMPTS, then gives up for good so a dead backend is not hammered forever. */
export function reconnectAction(attempt: number): ReconnectAction {
  return attempt > STREAM_MAX_ATTEMPTS
    ? { kind: "give-up" }
    : { kind: "retry", delayMs: reconnectDelayMs(attempt) };
}

/** Spreads a fleet of tabs reconnecting after one restart over up to half the delay again, so they do not all hit the server on the same tick. */
export function jittered(
  delayMs: number,
  random: () => number = Math.random,
): number {
  return Math.round(delayMs * (1 + random() * 0.5));
}
