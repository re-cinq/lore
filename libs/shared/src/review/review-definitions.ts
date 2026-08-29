/**
 * The assembly-line definitions the PR-review choreography owns. A PR's close
 * ends these and nothing else — other lines may carry the same `pr_number`
 * without having asked to be ended by it. pr-ready-check reads the same list
 * as "the address round-trip is still in flight" (implementation-loop FR4):
 * while one of these is open for a PR, unresolved threads mean wait, not
 * blocked.
 */
export const REVIEW_DEFINITIONS = [
  "code-review",
  "code-review-recheck",
  "code-review-reply",
  "comment-triage",
] as const;

/**
 * The one sentence that tells a human how to re-run a review by hand.
 *
 * It reached readers through four surfaces — the review body, the "review
 * started" comment, the PR check summary and the failure notice — in three
 * different wordings, because each surface had typed its own copy.
 */
export const REVIEW_RERUN_HINT = "Comment `@lore review` to re-run the review.";

/**
 * True for any line in the PR-review family, so a red check or a failure notice
 * on one can tell a human how to re-run it.
 *
 * The two hint sites keyed on `code-review` ALONE, which left the other three
 * definitions silent — including `code-review-recheck`, which is published under
 * the `lore/code-review` check name and so produced a red check, bearing the
 * review's own name, that said nothing about how to re-run it.
 */
export function isReviewDefinition(name: string): boolean {
  return (REVIEW_DEFINITIONS as readonly string[]).includes(name);
}
