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
      reason: "pr_conflicting" | "pr_behind" | "ci_red" | "unresolved_threads";
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
  /** Commits of the default branch the branch lacks; undefined when GitHub could not compare. */
  behindBy: number | undefined;
}

/** Verdict for await-pr: the branch is put on main before anything else is read (a conflicted branch gets no CI at all), then hasCiHistory distinguishes "no checks configured" (green) from "not started" (pending). */
export function decidePrReady(input: PrReadyInput): PrReadyVerdict {
  const verdict =
    syncVerdict(input) ??
    ciVerdict({ ci: input.ci, hasCiHistory: input.hasCiHistory });

  if (verdict) {
    return verdict;
  }
  const unresolved = input.threads.filter(
    (t) => !t.isResolved && !t.isOutdated,
  );

  return threadVerdict(unresolved.length, input.openReviewRunCount);
}

/** A conflict or a branch behind main goes to the sync, which rebases it and returns to the wait; null when the branch is on current main. */
function syncVerdict(
  input: Pick<PrReadyInput, "mergeable" | "behindBy">,
): PrReadyVerdict | null {
  if (input.mergeable === false) {
    return blocked("pr_conflicting");
  }

  return (input.behindBy ?? 0) > 0 ? blocked("pr_behind") : null;
}

function blocked(reason: "pr_conflicting" | "pr_behind" | "ci_red"): PrReadyVerdict {
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
