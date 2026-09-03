/** Progressive trust ladder as repos merge Lore-authored PRs (#1354). */

/** Ascending order. A repo at `full` has nowhere left to climb. */
export const TRUST_LEVELS = [
  "docs",
  "tests",
  "implementation",
  "full",
] as const;

export type TrustLevel = (typeof TRUST_LEVELS)[number];

export interface TrustState {
  level?: string;
  successful_tasks?: number;
  auto_promote_threshold?: number;
}

export interface TrustDecision {
  /** No write at all — the repo is already at `full`, or carries no level. */
  hold: boolean;
  level: TrustLevel | undefined;
  /** Merges banked at the current level; reset to 0 on promotion. */
  successfulTasks: number;
  promoted: boolean;
}

const DEFAULT_THRESHOLD = 3;

/** Decide the trust state after one more successful merge. */
export function nextTrust(trust: TrustState | undefined): TrustDecision {
  const level = trust?.level as TrustLevel | undefined;

  // No level recorded or already at `full`: hold until promotion is possible.
  if (!level || level === "full") {
    return {
      hold: true,
      level,
      successfulTasks: trust?.successful_tasks ?? 0,
      promoted: false,
    };
  }

  const threshold = trust?.auto_promote_threshold || DEFAULT_THRESHOLD;
  const banked = (trust?.successful_tasks ?? 0) + 1;

  if (banked < threshold) {
    return { hold: false, level, successfulTasks: banked, promoted: false };
  }

  // Math.min guards unrecognised level: indexOf(-1) + 1 = 0 demotes safely.
  const nextIndex = Math.min(
    TRUST_LEVELS.indexOf(level) + 1,
    TRUST_LEVELS.length - 1,
  );

  return {
    hold: false,
    level: TRUST_LEVELS[nextIndex],
    successfulTasks: 0,
    promoted: true,
  };
}
