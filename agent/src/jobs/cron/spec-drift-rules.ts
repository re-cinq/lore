/**
 * Rules that decide what spec-drift acts on. Kept pure and separate from the
 * job so the doc-type filter and dedup window are unit-testable.
 */

/** Speckit artifacts that are prose, not named-symbol sources — scanning them
 * for "missing code symbols" yields permanent 100% false drift. */
const NON_ASSERTION_BASENAMES = new Set(["research", "plan", "tasks", "quickstart"]);

/** True when a spec file is worth checking for drift (names code, not concepts). */
export function isAssertionSource(filePath: string): boolean {
  const file = filePath.split("/").pop() || filePath;
  const stem = file.replace(/\.[^.]+$/, "").toLowerCase();
  return !NON_ASSERTION_BASENAMES.has(stem);
}

/** Days a resolved (merged/completed/cancelled) spec keeps suppressing re-filing. */
export const DRIFT_REFILE_COOLDOWN_DAYS = 14;

/** Task states where a drift loop is still open — always suppress a new task. */
const OPEN_STATES = new Set([
  "pending",
  "queued",
  "running",
  "pr-created",
  "review",
  "retried",
  "failed",
]);

interface ExistingDriftTask {
  status: string;
  created_at: string | Date;
}

/**
 * Skip creating a drift task when one is already open for the spec, or when a
 * resolved one is still within the cooldown — stops the weekly duplicate PRs.
 */
export function shouldSkipDrift(existing: ExistingDriftTask[], now: Date): boolean {
  const cooldownMs = DRIFT_REFILE_COOLDOWN_DAYS * 86400_000;
  return existing.some((t) => {
    if (OPEN_STATES.has(t.status)) return true;
    const age = now.getTime() - new Date(t.created_at).getTime();
    return age < cooldownMs;
  });
}
