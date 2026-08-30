import type {
  CiConclusion,
  ReviewThread,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

/** What the sweep does with one parked run (specs/implementation-loop FR4). */
export type PrReadyVerdict =
  | { kind: "ready" }
  | {
      kind: "wait";
      reason: "ci_pending" | "ci_not_started" | "address_in_flight";
    }
  | { kind: "blocked"; reason: "ci_red" | "unresolved_threads" };

/**
 * Pure verdict for one parked await-pr node. Red CI blocks immediately — no
 * review round-trip fixes a build the agent already retried. Unresolved
 * threads block only once the PR-review choreography has had its chance,
 * defined as: no run of the review family is open for this PR.
 *
 * `none` is ambiguous and the two readings are opposites: a repo with no checks
 * configured (green — it cannot wedge its loop) versus a repo whose checks have
 * not registered for this head sha YET (not started — resuming would pass a
 * build nobody ran). `hasCiHistory` separates them, and it is a REPO fact rather
 * than a clock, which is what keeps this function pure and testable with no
 * fake timers. It is required, not optional-with-a-default: a defaulted flag
 * silently restores the racy reading at every call site that forgets it.
 */
export function decidePrReady(input: {
  ci: CiConclusion;
  threads: readonly ReviewThread[];
  openReviewRunCount: number;
  /** Does this repo run checks at all? */
  hasCiHistory: boolean;
}): PrReadyVerdict {
  if (input.ci === "pending") {
    return { kind: "wait", reason: "ci_pending" };
  }

  if (input.ci === "none" && input.hasCiHistory) {
    return { kind: "wait", reason: "ci_not_started" };
  }

  if (input.ci === "failure") {
    return { kind: "blocked", reason: "ci_red" };
  }
  const unresolved = input.threads.filter(
    (t) => !t.isResolved && !t.isOutdated,
  );

  if (unresolved.length === 0) {
    return { kind: "ready" };
  }

  return input.openReviewRunCount > 0
    ? { kind: "wait", reason: "address_in_flight" }
    : { kind: "blocked", reason: "unresolved_threads" };
}
