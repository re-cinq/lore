/** Pure retry decision: exponential backoff capped at 5 minutes, then dead-letter. */

export const MAX_ATTEMPTS = 5;
const BACKOFF_CAP_SECONDS = 300;

export type RetryDecision =
  { kind: "retry"; backoffSeconds: number } | { kind: "dead" };

export function decideRetry(state: {
  attempts: number;
  max?: number;
}): RetryDecision {
  const max = state.max ?? MAX_ATTEMPTS;

  if (state.attempts >= max) {
    return { kind: "dead" };
  }
  const backoffSeconds = Math.min(2 ** state.attempts, BACKOFF_CAP_SECONDS);

  return { kind: "retry", backoffSeconds };
}
