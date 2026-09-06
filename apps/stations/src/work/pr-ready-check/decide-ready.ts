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
  // outcome routes the walk (selectEdge), reason populates run.args; blocked reasons must have DIFFERENT outcomes (specs/implementation-loop FR3)
  | {
      kind: "blocked";
      reason: "ci_red" | "unresolved_threads";
      outcome: "changes_requested" | "failed";
    };

/** The CI-only half of the verdict, or null to fall through to the thread check. */
function ciVerdict(
  ci: CiConclusion,
  hasCiHistory: boolean,
): PrReadyVerdict | null {
  if (ci === "pending") {
    return { kind: "wait", reason: "ci_pending" };
  }

  if (ci === "none" && hasCiHistory) {
    return { kind: "wait", reason: "ci_not_started" };
  }

  if (ci === "failure") {
    return { kind: "blocked", reason: "ci_red", outcome: "changes_requested" };
  }

  return null;
}

/** The thread-only half of the verdict, once CI has already come back green. */
function threadVerdict(
  unresolvedCount: number,
  openReviewRunCount: number,
): PrReadyVerdict {
  if (unresolvedCount === 0) {
    return { kind: "ready" };
  }

  return openReviewRunCount > 0
    ? { kind: "wait", reason: "address_in_flight" }
    : { kind: "blocked", reason: "unresolved_threads", outcome: "failed" };
}

/** Verdict for await-pr: hasCiHistory distinguishes "no checks configured" (green) from "not started" (pending). */
export function decidePrReady(input: {
  ci: CiConclusion;
  threads: readonly ReviewThread[];
  openReviewRunCount: number;
  /** Does this repo run checks at all? */
  hasCiHistory: boolean;
}): PrReadyVerdict {
  const ci = ciVerdict(input.ci, input.hasCiHistory);

  if (ci) {
    return ci;
  }
  const unresolved = input.threads.filter(
    (t) => !t.isResolved && !t.isOutdated,
  );

  return threadVerdict(unresolved.length, input.openReviewRunCount);
}
