// What to do about one failed delivery — pure retry-ladder decision.

export type DeliveryOutcome =
  { kind: "retry"; delayMs: number } | { kind: "drop" };

export function nextDeliveryStep(state: {
  /** 1-based: the attempt that just failed. */
  attempt: number;
  attempts: number;
  delayMs: number;
}): DeliveryOutcome {
  if (state.attempt >= state.attempts) {
    return { kind: "drop" };
  }

  // Linear, not exponential — a blip is measured in hundreds of ms; the bus's exponential dead-letter backoff (retry.ts) governs a different failure.
  return { kind: "retry", delayMs: state.delayMs * state.attempt };
}
