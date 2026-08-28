/**
 * What to do about one failed delivery — the retry ladder, as a pure decision.
 *
 * This is the logic that used to live inside the cluster-agent's watch reporter,
 * where it was reachable only by driving a Kubernetes watch. Every producer that
 * reports to the router needs the same ladder, and exactly one of them had it.
 *
 * `reauth` and `next` are separate because the last attempt still wants the
 * rotation: a refused credential means the token was rotated elsewhere, so
 * re-registering after the final failure is what keeps the NEXT message from
 * being lost as well. Retrying with the rotated-out token five times and then
 * giving up is precisely how run 595d2b0b lost its terminal event (2026-08-28).
 */

export type DeliveryOutcome =
  { kind: "retry"; delayMs: number } | { kind: "drop" };

export interface DeliveryStep {
  /** Rotate the credential before doing `next`. */
  reauth: boolean;
  next: DeliveryOutcome;
}

/**
 * Whether the sink REFUSED the credential, as opposed to failing.
 *
 * Reads the `status` that `HttpEventReporter.insert` attaches to its throw. A
 * timeout or a dead socket carries no status and must not be read as a refusal —
 * rotating the token on every blip would churn the identity for nothing.
 */
export function isUnauthorized(err: unknown): boolean {
  const status = (err as { status?: number }).status;

  return status === 401 || status === 403;
}

export function nextDeliveryStep(state: {
  error: unknown;
  /** 1-based: the attempt that just failed. */
  attempt: number;
  attempts: number;
  delayMs: number;
}): DeliveryStep {
  const reauth = isUnauthorized(state.error);

  if (state.attempt >= state.attempts) {
    return { reauth, next: { kind: "drop" } };
  }

  // Linear, not exponential: the ladder this replaces was linear, and a router
  // blip is measured in hundreds of milliseconds. The bus's own dead-letter
  // backoff (retry.ts) is the exponential one, and it governs a different
  // failure — a handler that keeps throwing, not a wire that keeps dropping.
  return {
    reauth,
    next: { kind: "retry", delayMs: state.delayMs * state.attempt },
  };
}
