// What to do about one failed delivery — pure retry-ladder decision; `reauth` and `next` are separate so even the final failed attempt still triggers rotation, or the NEXT message is lost too (run 595d2b0b, 2026-08-28).

export type DeliveryOutcome =
  { kind: "retry"; delayMs: number } | { kind: "drop" };

export interface DeliveryStep {
  /** Rotate the credential before doing `next`. */
  reauth: boolean;
  next: DeliveryOutcome;
}

/** Whether the sink REFUSED the credential (status 401/403), not merely failed — a timeout/dead socket has no status and must not trigger rotation. */
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

  // Linear, not exponential — a router blip is measured in hundreds of ms; the bus's exponential dead-letter backoff (retry.ts) governs a different failure.
  return {
    reauth,
    next: { kind: "retry", delayMs: state.delayMs * state.attempt },
  };
}
