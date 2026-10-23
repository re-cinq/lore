import type { CiConclusion } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { ciWait } from "./decide-ready.js";

/** What the auto-merge loop's wait does with one pull request (specs/protected-branch-merge): it is ready, or it waits. The loop fixes nothing itself; the loop that opened the pull request does. */
export type MergeReadyVerdict =
  | { kind: "ready" }
  | {
      kind: "wait";
      reason:
        | "pr_conflicting"
        | "ci_red"
        | "ci_pending"
        | "ci_not_started"
        | "unresolved_threads"
        | "address_in_flight"
        | "review_changes_requested"
        | "review_pending"
        | "too_young";
    };

export interface MergeReadyInput {
  /** GitHub's mergeability: false on a conflict, which gets no CI at all. */
  mergeable: boolean | null;
  /** The repository's own checks, Lore's excluded. */
  ci: CiConclusion;
  hasCiHistory: boolean;
  unresolvedThreads: number;
  /** Review, re-check or reply runs still open on the pull request. */
  openReviewRuns: number;
  /** Lore's review verdict on the head, from its `lore/code-review` check. */
  review: "approved" | "changes_requested" | "none";
  ageHours: number;
  minAgeHours: number;
}

/** In order: a conflict and red CI, open threads, Lore's review standing approved on the head, and only then the minimum age. */
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
    return wait("pr_conflicting");
  }

  return input.ci === "failure" ? wait("ci_red") : ciWait(input);
}

function threadVerdict(input: MergeReadyInput): MergeReadyVerdict | null {
  if (input.unresolvedThreads === 0) {
    return null;
  }

  return wait(
    input.openReviewRuns > 0 ? "address_in_flight" : "unresolved_threads",
  );
}

/** A review still running, or none yet on this head (the re-check runs on every push), and changes it asked for are all waited out. */
function reviewVerdict(input: MergeReadyInput): MergeReadyVerdict | null {
  if (input.review === "approved") {
    return null;
  }

  return wait(
    input.review === "changes_requested" && input.openReviewRuns === 0
      ? "review_changes_requested"
      : "review_pending",
  );
}

function ageVerdict(input: MergeReadyInput): MergeReadyVerdict {
  return input.ageHours < input.minAgeHours
    ? wait("too_young")
    : { kind: "ready" };
}

function wait(
  reason: Extract<MergeReadyVerdict, { kind: "wait" }>["reason"],
): MergeReadyVerdict {
  return { kind: "wait", reason };
}
