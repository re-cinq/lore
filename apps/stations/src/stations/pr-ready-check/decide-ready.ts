import type {
  CiConclusion,
  ReviewThread,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

/** What the sweep does with one parked run (specs/implementation-loop FR4). */
export type PrReadyVerdict =
  | { kind: "ready" }
  | { kind: "wait"; reason: "ci_pending" | "address_in_flight" }
  | { kind: "blocked"; reason: "ci_red" | "unresolved_threads" };

/**
 * Pure verdict for one parked await-pr node. Red CI blocks immediately — no
 * review round-trip fixes a build the agent already retried. Unresolved
 * threads block only once the PR-review choreography has had its chance,
 * defined as: no run of the review family is open for this PR. `none` counts
 * as green so a repo with no checks cannot wedge its loop.
 */
export function decidePrReady(input: {
  ci: CiConclusion;
  threads: readonly ReviewThread[];
  openReviewRunCount: number;
}): PrReadyVerdict {
  if (input.ci === "pending") {
    return { kind: "wait", reason: "ci_pending" };
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
