import { ciConclusionOf, summarizeFailedChecks } from "@re-cinq/lore-shared";
import type { CheckRun } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

/** What a red build hands the next agent step: which sha it judged, which checks failed, and whatever those jobs reported. Reaches the pod through the run's args (FR15). */
// eslint-disable-next-line re-lint/no-row-types-outside-models -- these are keys of pipeline.assembly_runs.args, a jsonb bag the resume handler merges into; they are not columns of any table.
export interface CiFeedbackArgs {
  ci_feedback_sha: string;
  ci_failed_checks: string;
  ci_failure_summary: string;
}

/** What the sweep does with one run parked at `await-ci`. */
export type CiCheckVerdict =
  | { kind: "ready" }
  | {
      kind: "wait";
      reason: "ci_pending" | "ci_not_started" | "no_judgeable_sha";
    }
  // As on the await-pr wait, the two blocked reasons carry DIFFERENT outcomes, because only `outcome` routes: a build the line can repair goes back to a round, one it demonstrably cannot goes to a human.
  | {
      kind: "blocked";
      reason: "ci_red";
      outcome: "changes_requested";
      feedback: CiFeedbackArgs;
    }
  | {
      kind: "blocked";
      reason: "ci_red_unchanged";
      outcome: "failed";
      feedback: CiFeedbackArgs;
    };

/** Verdict for await-ci: CI on the pull request is the whole judgement — review threads belong to the wait at the END of the line, not to a round. */
export function decideCiReady(input: {
  checks: readonly CheckRun[];
  hasCiHistory: boolean;
  judgedSha: string | null;
  /** The sha a red verdict was last reported for, from the run's args. */
  lastReportedSha: string | null;
}): CiCheckVerdict {
  if (!input.judgedSha) {
    return { kind: "wait", reason: "no_judgeable_sha" };
  }
  const conclusion = ciConclusionOf(input.checks);

  if (conclusion === "pending") {
    return { kind: "wait", reason: "ci_pending" };
  }

  if (conclusion === "none" && input.hasCiHistory) {
    return { kind: "wait", reason: "ci_not_started" };
  }

  return conclusion === "failure"
    ? redVerdict(input.checks, input.judgedSha, input.lastReportedSha)
    : { kind: "ready" };
}

/** What a red build tells the next step, whichever way it routes. */
function redFeedback(
  checks: readonly CheckRun[],
  judgedSha: string,
): CiFeedbackArgs {
  const failed = summarizeFailedChecks(checks);

  return {
    ci_feedback_sha: judgedSha,
    ci_failed_checks: failed.names.join(", "),
    ci_failure_summary: failed.summary,
  };
}

/** A red build, told apart by whether the round that saw it last pushed anything. An unchanged sha means the round did not move the branch, and twelve more pods would learn the same thing twelve more times. */
function redVerdict(
  checks: readonly CheckRun[],
  judgedSha: string,
  lastReportedSha: string | null,
): CiCheckVerdict {
  const feedback = redFeedback(checks, judgedSha);

  return judgedSha === lastReportedSha
    ? {
        kind: "blocked",
        reason: "ci_red_unchanged",
        outcome: "failed",
        feedback,
      }
    : {
        kind: "blocked",
        reason: "ci_red",
        outcome: "changes_requested",
        feedback,
      };
}
