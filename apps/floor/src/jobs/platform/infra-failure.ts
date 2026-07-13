/**
 * Classifies Job-pod failure reasons as transient infrastructure failures
 * (worth a bounded retry) vs task-content failures (terminal). Pure and
 * domain-neutral — the loretask-watcher uses it to self-heal failures like the
 * #571 batch (a bad-secret deploy → CreateContainerConfigError →
 * BackoffLimitExceeded) instead of filing terminal `lore-failed` issues.
 */

const TRANSIENT_INFRA_PATTERNS = [
  "BackoffLimitExceeded",
  "CreateContainerConfigError",
  "CreateContainerError",
  "ImagePullBackOff",
  "ErrImagePull",
];

/** How many times an infra-failed task is re-queued before terminal failure. */
export const MAX_INFRA_RETRIES = 2;

export function isTransientInfraFailure(
  reason: string | null | undefined,
): boolean {
  if (!reason) return false;
  return TRANSIENT_INFRA_PATTERNS.some((p) => reason.includes(p));
}
