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
      reason:
        | "pr_conflicting"
        | "pr_behind"
        | "ci_red"
        | "review_changes_requested"
        | "unresolved_threads";
      outcome: "changes_requested" | "failed";
    };

export interface PrReadyInput {
  ci: CiConclusion;
  threads: readonly ReviewThread[];
  openReviewRunCount: number;
  /** Does this repo run checks at all? */
  hasCiHistory: boolean;
  /** GitHub's mergeability: false on a conflict, null while GitHub computes it. */
  mergeable: boolean | null;
  /** GitHub's `mergeable_state`: `behind` only when a branch rule asks the pull request to be up to date with its base. */
  mergeState: string;
  /** Lore's review verdict on the head, from its `lore/code-review` check. */
  review: "approved" | "changes_requested" | "none";
}

/** Verdict for await-pr: the branch is put on main before anything else is read (a conflicted branch gets no CI at all), then hasCiHistory distinguishes "no checks configured" (green) from "not started" (pending). Changes Lore's own review asked for go to the fix like red CI does: GitHub keeps Lore from requesting changes on a pull request it opened, so no reply line ever answers them. */
export function decidePrReady(input: PrReadyInput): PrReadyVerdict {
  const verdict =
    syncVerdict(input) ??
    ciVerdict({ ci: input.ci, hasCiHistory: input.hasCiHistory }) ??
    reviewVerdict(input);

  if (verdict) {
    return verdict;
  }
  const unresolved = input.threads.filter(
    (t) => !t.isResolved && !t.isOutdated,
  );

  return threadVerdict(unresolved.length, input.openReviewRunCount);
}

/** A conflict, or a branch GitHub calls behind, goes to the sync, which rebases it and returns to the wait; null otherwise. A branch merely behind main is not rebased: GitHub merges it as it is unless a branch rule asks it to be up to date, and rebasing it on every move of main kept a busy repository's pull requests rebasing instead of merging (lore #2876, six rebases in one run). */
function syncVerdict(
  input: Pick<PrReadyInput, "mergeable" | "mergeState">,
): PrReadyVerdict | null {
  if (input.mergeable === false) {
    return blocked("pr_conflicting");
  }

  return input.mergeState === "behind" ? blocked("pr_behind") : null;
}

function blocked(
  reason:
    "pr_conflicting" | "pr_behind" | "ci_red" | "review_changes_requested",
): PrReadyVerdict {
  return { kind: "blocked", reason, outcome: "changes_requested" };
}

/** The CI-only half of the verdict, or null to fall through to the thread check. */
function ciVerdict(input: CiState): PrReadyVerdict | null {
  return input.ci === "failure" ? blocked("ci_red") : ciWait(input);
}

interface CiState {
  ci: CiConclusion;
  hasCiHistory: boolean;
}

/** CI still to come: running, or not started yet on a branch whose earlier pushes had checks. */
export function ciWait(
  input: CiState,
): { kind: "wait"; reason: "ci_pending" | "ci_not_started" } | null {
  if (input.ci === "pending") {
    return { kind: "wait", reason: "ci_pending" };
  }

  return input.ci === "none" && input.hasCiHistory
    ? { kind: "wait", reason: "ci_not_started" }
    : null;
}

/** Lore asked for changes on the head: the fix, unless a re-check of a newer push is still judging it. */
function reviewVerdict(
  input: Pick<PrReadyInput, "review" | "openReviewRunCount">,
): PrReadyVerdict | null {
  if (input.review !== "changes_requested") {
    return null;
  }

  return input.openReviewRunCount > 0
    ? { kind: "wait", reason: "address_in_flight" }
    : blocked("review_changes_requested");
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
