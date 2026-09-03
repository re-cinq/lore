/** Assembly-line definitions the PR-review choreography owns; a PR's close ends only these (other lines may share `pr_number` without asking to be ended by it) — pr-ready-check reads this list as "review round-trip still in flight" (implementation-loop FR4). */
export const REVIEW_DEFINITIONS = [
  "code-review",
  "code-review-recheck",
  "code-review-reply",
  "comment-triage",
] as const;

/** The one sentence telling a human how to re-run a review by hand; unifies what used to be three different wordings across four surfaces. */
export const REVIEW_RERUN_HINT = "Comment `@lore review` to re-run the review.";

/** True for any line in the PR-review family, so a red check or failure notice can tell a human how to re-run it — fixes the two hint sites that keyed on `code-review` alone and left `code-review-recheck` etc. silent. */
export function isReviewDefinition(name: string): boolean {
  return (REVIEW_DEFINITIONS as readonly string[]).includes(name);
}
