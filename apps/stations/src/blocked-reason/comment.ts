// The one comment on a PR, and on its backlog issue, that says why the PR is not merging yet; found again by its marker, so it is edited in place and never posted twice.

import {
  labelForReason,
  type BlockedReason,
} from "@re-cinq/lore-shared/blocked-reason.js";
import type { IssueCollection } from "@re-cinq/lore-shared/project/issues/issues.js";

export const BLOCKED_REASON_MARKER = "<!-- lore:blocked-reason -->";

const UPDATES = "Lore updates this comment when the reason changes.";

/** A conversation the comment lives in: a PR's or an issue's, both GitHub issue comments. */
export type CommentThread = Pick<
  IssueCollection,
  "listComments" | "comment" | "updateComment"
>;

export function blockedReasonComment(blocked: BlockedReason | null): string {
  const headline = blocked
    ? `Not merging yet: ${labelForReason(blocked.reason, blocked.detail)}.`
    : "Nothing blocks this PR from merging now.";

  return `${headline} ${UPDATES}\n\n${BLOCKED_REASON_MARKER}`;
}

/** Edit the marker comment on `number`, or post it when there is none yet and something blocks; a cleared reason with no comment writes nothing. */
export async function syncReasonComment(
  thread: CommentThread,
  number: number,
  blocked: BlockedReason | null,
): Promise<void> {
  const comments = await thread.listComments(number);
  const existing = comments.find((c) => c.body.includes(BLOCKED_REASON_MARKER));
  const body = blockedReasonComment(blocked);

  if (existing) {
    return thread.updateComment(existing.id, body);
  }

  if (blocked) {
    await thread.comment(number, body);
  }
}
