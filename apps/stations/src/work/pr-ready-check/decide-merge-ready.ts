import type { CiConclusion } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

/** What the auto-merge loop's wait does with one pull request (specs/protected-branch-merge). */
export type MergeReadyVerdict =
  | { kind: "ready" }
  | {
      kind: "wait";
      reason:
        | "ci_pending"
        | "ci_not_started"
        | "address_in_flight"
        | "review_pending"
        | "too_young";
    }
  | {
      kind: "blocked";
      reason:
        | "pr_conflicting"
        | "ci_red"
        | "unresolved_threads"
        | "review_changes_requested";
      outcome: "changes_requested";
    }
  | { kind: "blocked"; reason: "ci_red_unchanged"; outcome: "failed" };

export interface MergeReadyInput {
  /** GitHub's mergeability: false on a conflict, which gets no CI at all. */
  mergeable: boolean | null;
  /** The repository's own checks, Lore's excluded. */
  ci: CiConclusion;
  hasCiHistory: boolean;
  /** The commit CI judged, and the one the last red verdict named: the same sha red again means the fix pushed nothing. */
  judgedSha: string;
  lastRedSha: string | null;
  unresolvedThreads: number;
  /** Review, re-check or reply runs still open on the pull request. */
  openReviewRuns: number;
  /** Lore's review verdict on the head, from its `lore/code-review` check. */
  review: "approved" | "changes_requested" | "none";
  ageHours: number;
  minAgeHours: number;
}

/** In order: a conflict and red CI are fixed first, open threads next, then Lore's review must stand approved on the head, and only then does the pull request wait out its minimum age. */
export function decideMergeReady(input: MergeReadyInput): MergeReadyVerdict {
  return (
    buildVerdict(input) ??
    threadVerdict(input) ??
    reviewVerdict(input) ??
    ageVerdict(input)
  );
}

function buildVerdict(input: MergeReadyInput): MergeReadyVerdict | null {
  if (input.mergeable === false) {
    return blocked("pr_conflicting");
  }

  if (input.ci === "pending") {
    return { kind: "wait", reason: "ci_pending" };
  }

  if (input.ci === "none" && input.hasCiHistory) {
    return { kind: "wait", reason: "ci_not_started" };
  }

  if (input.ci !== "failure") {
    return null;
  }

  return input.judgedSha === input.lastRedSha
    ? { kind: "blocked", reason: "ci_red_unchanged", outcome: "failed" }
    : blocked("ci_red");
}

function threadVerdict(input: MergeReadyInput): MergeReadyVerdict | null {
  if (input.unresolvedThreads === 0) {
    return null;
  }

  return input.openReviewRuns > 0
    ? { kind: "wait", reason: "address_in_flight" }
    : blocked("unresolved_threads");
}

/** A review still running, or none yet on this head (the re-check runs on every push), is waited for; changes it asked for with no thread left open go to the fix. */
function reviewVerdict(input: MergeReadyInput): MergeReadyVerdict | null {
  if (input.review === "approved") {
    return null;
  }

  return input.review === "changes_requested" && input.openReviewRuns === 0
    ? blocked("review_changes_requested")
    : { kind: "wait", reason: "review_pending" };
}

function ageVerdict(input: MergeReadyInput): MergeReadyVerdict {
  return input.ageHours < input.minAgeHours
    ? { kind: "wait", reason: "too_young" }
    : { kind: "ready" };
}

function blocked(
  reason: Exclude<
    Extract<MergeReadyVerdict, { kind: "blocked" }>["reason"],
    "ci_red_unchanged"
  >,
): MergeReadyVerdict {
  return { kind: "blocked", reason, outcome: "changes_requested" };
}
