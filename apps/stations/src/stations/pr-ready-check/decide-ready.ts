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

/** Verdict for await-pr: hasCiHistory distinguishes "no checks configured" (green) from "not started" (pending). */
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
    return { kind: "blocked", reason: "ci_red", outcome: "changes_requested" };
  }
  const unresolved = input.threads.filter(
    (t) => !t.isResolved && !t.isOutdated,
  );

  if (unresolved.length === 0) {
    return { kind: "ready" };
  }

  return input.openReviewRunCount > 0
    ? { kind: "wait", reason: "address_in_flight" }
    : {
        kind: "blocked",
        reason: "unresolved_threads",
        outcome: "failed",
      };
}
