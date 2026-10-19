// The verdict of a review and the completed lore/code-review check that publishes it.

import { parseReviewFindings } from "@re-cinq/lore-shared/review/review-findings.js";
import { parseReviewVerdict } from "@re-cinq/lore-assembly-lines";
import type { CheckRunInput } from "@re-cinq/lore-shared/project/lib/github-port.js";
import {
  checkDisplayName,
  loreCheckName,
} from "@re-cinq/lore-shared/project/pulls/check-runs.js";

export type ReviewVerdict = "success" | "changes_requested";

/** The verdict the posted review carries: the findings block when it parsed (what was actually posted), else the REVIEW_RESULT line. */
export function reviewVerdictOf(agentOutput: string): ReviewVerdict | null {
  const findings = parseReviewFindings(agentOutput);

  if (findings) {
    return findings.verdict === "approved" ? "success" : "changes_requested";
  }

  return parseReviewVerdict(agentOutput);
}

export function findingCountOf(agentOutput: string): number {
  return parseReviewFindings(agentOutput)?.findings.length ?? 0;
}

export interface ReviewCheckInput {
  headSha: string;
  verdict: ReviewVerdict;
  summary: string;
}

/** The completed `lore/code-review` check: the only place a verdict survives on a PR the review App itself authored. `neutral` is changes requested, which is what `loreReviewVerdict` reads back; `failure` stays the mark of a review that never ran. */
export function reviewCheck({
  headSha,
  verdict,
  summary,
}: ReviewCheckInput): CheckRunInput {
  return {
    headSha,
    name: loreCheckName("code-review"),
    title: `Lore ${checkDisplayName("code-review")}`,
    status: "completed",
    conclusion: verdict === "success" ? "success" : "neutral",
    summary,
  };
}
