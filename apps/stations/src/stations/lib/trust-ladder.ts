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

function currentLevel(trust: TrustState | undefined): TrustLevel | undefined {
  return trust?.level as TrustLevel | undefined;
}

function bankedTasks(trust: TrustState | undefined): number {
  return trust?.successful_tasks ?? 0;
}

function promotionThreshold(trust: TrustState | undefined): number {
  return trust?.auto_promote_threshold || DEFAULT_THRESHOLD;
}

// The next rung up from `level`; Math.min guards an unrecognised level (indexOf(-1) + 1 = 0 demotes safely rather than throwing).
function promotedLevel(level: TrustLevel): TrustLevel {
  const nextIndex = Math.min(
    TRUST_LEVELS.indexOf(level) + 1,
    TRUST_LEVELS.length - 1,
  );

  return TRUST_LEVELS[nextIndex];
}

/** Decide the trust state after one more successful merge. */
export function nextTrust(trust: TrustState | undefined): TrustDecision {
  const level = currentLevel(trust);

  // No level recorded or already at `full`: hold until promotion is possible.
  if (!level || level === "full") {
    return {
      hold: true,
      level,
      successfulTasks: bankedTasks(trust),
      promoted: false,
    };
  }

  const banked = bankedTasks(trust) + 1;

  if (banked < promotionThreshold(trust)) {
    return { hold: false, level, successfulTasks: banked, promoted: false };
  }

  return {
    hold: false,
    level: promotedLevel(level),
    successfulTasks: 0,
    promoted: true,
  };
}
