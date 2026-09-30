import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { parseReviewReply } from "@re-cinq/lore-shared/review/review-reply.js";
import type {
  IssueComment,
  ReviewComment,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import {
  resolveRepliedThread,
  type ThreadResolver,
} from "./reply-thread-resolve.js";

export interface ReplyPoster extends ThreadResolver {
  replyToReviewComment(
    prNumber: number,
    commentId: number,
    body: string,
  ): Promise<void>;
  comment(prNumber: number, body: string): Promise<void>;
  listComments(prNumber: number): Promise<ReviewComment[]>;
  listIssueComments(prNumber: number): Promise<IssueComment[]>;
}

export interface ReplyDelivery {
  poster: ReplyPoster;
  prNumber: number;
  visitId: string;
  iteration: number;
  replyOutput: string;
  commentId: number;
  intent: string;
}

export type ReplyPostOutcome = "posted" | "already_posted";

export function replyMarker(visitId: string, iteration: number): string {
  return `<!-- lore-reply-run: ${visitId}/${iteration} -->`;
}

export function stampedReply(
  body: string,
  visitId: string,
  iteration: number,
): string {
  return `${body}\n\n_Posted by floor, visit ${visitId}._\n\n${replyMarker(visitId, iteration)}`;
}

export async function postReply(
  delivery: ReplyDelivery,
): Promise<ReplyPostOutcome> {
  const { poster, prNumber, visitId, iteration, commentId } = delivery;
  const body = parseReviewReply(delivery.replyOutput);

  enforceTrue(body, Error, "reply output carries no REVIEW_REPLY block");

  if (await markerOnPr(poster, prNumber, replyMarker(visitId, iteration))) {
    return "already_posted";
  }
  const stamped = stampedReply(body, visitId, iteration);

  if (commentId <= 0) {
    await poster.comment(prNumber, stamped);

    return "posted";
  }
  await poster.replyToReviewComment(prNumber, commentId, stamped);
  await resolveRepliedThread(poster, { prNumber, commentId }, delivery.intent);

  return "posted";
}

async function markerOnPr(
  poster: ReplyPoster,
  prNumber: number,
  marker: string,
): Promise<boolean> {
  const [threadComments, issueComments] = await Promise.all([
    poster.listComments(prNumber),
    poster.listIssueComments(prNumber),
  ]);

  return [...threadComments, ...issueComments].some((comment) =>
    comment.body.includes(marker),
  );
}
