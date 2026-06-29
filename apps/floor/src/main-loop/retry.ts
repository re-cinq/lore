/**
 * Pure retry decision for the event loop. `attempts` is the post-claim count
 * (incremented when the row is claimed), so a handler that just threw sees its own
 * attempt already reflected here. Exponential backoff capped at 5 minutes, then a
 * hard dead-letter so a permanently-broken handler can't loop forever.
 */

export const MAX_ATTEMPTS = 5;
const BACKOFF_CAP_SECONDS = 300;

export type RetryDecision = { kind: "retry"; backoffSeconds: number } | { kind: "dead" };

export function decideRetry(state: { attempts: number; max?: number }): RetryDecision {
  const max = state.max ?? MAX_ATTEMPTS;
  if (state.attempts >= max) return { kind: "dead" };
  const backoffSeconds = Math.min(2 ** state.attempts, BACKOFF_CAP_SECONDS);
  return { kind: "retry", backoffSeconds };
}
