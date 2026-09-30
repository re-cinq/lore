// What a settled review run owes its pull request: a run that ended without posting a review leaves a red `lore/code-review` check, so the pull request never reads as reviewed.
import type { RunView } from "@re-cinq/floor-client";
import type { CheckRunInput } from "@re-cinq/lore-shared/project/lib/github-port.js";
import {
  checkDisplayName,
  loreCheckName,
} from "@re-cinq/lore-shared/project/pulls/check-runs.js";
import { REVIEW_RERUN_HINT } from "@re-cinq/lore-shared/review/review-definitions.js";

const REVIEWING_LINES = ["code-review", "code-review-recheck"];
// `iteration_max` is how a run ends when its review agent failed, was retried once and failed again: the retry edge is spent, and that is a broken review like any other.
const UNFINISHED_OUTCOMES = ["failed", "error", "iteration_max"];

/** A cancelled run is a closed or superseded pull request, which owes nothing; only a review that broke does. */
export function reviewBroke(lineId: string, outcome: string): boolean {
  return (
    REVIEWING_LINES.includes(lineId) && UNFINISHED_OUTCOMES.includes(outcome)
  );
}

export function startValueOf(run: RunView, name: string): string | undefined {
  const startItems: Partial<RunView["startItems"]> = run.startItems;

  return startItems[name]?.ref;
}

export function brokenReviewCheck(
  headSha: string,
  run: RunView,
): CheckRunInput {
  return {
    headSha,
    name: loreCheckName(run.lineId),
    title: `Lore ${checkDisplayName(run.lineId)}`,
    status: "completed",
    conclusion: "failure",
    summary: `The review did not complete: ${run.reason ?? run.outcome ?? "no reason given"}. ${REVIEW_RERUN_HINT}`,
  };
}
