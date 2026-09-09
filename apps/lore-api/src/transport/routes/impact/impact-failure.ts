/** The stack of a failed impact read, falling back to its message — impact is fail-soft, so the log line is the only trace a failure leaves. */
export function failureReason(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}
