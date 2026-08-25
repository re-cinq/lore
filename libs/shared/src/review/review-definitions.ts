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
