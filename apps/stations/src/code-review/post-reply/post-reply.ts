import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  parseReviewReply,
  parseThreadReplies,
  type ThreadReply,
} from "@re-cinq/lore-shared/review/review-reply.js";
import type {
  IssueComment,
  ReviewComment,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { inlineCommentsOf } from "../read-review/read-review.js";
import {
  resolveRepliedThreads,
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
  /** The submitted review being answered; a thread reply is posted only under a comment of that review. */
  reviewId: number | null;
}

export type ReplyPostOutcome = "posted" | "already_posted";

type Visit = Pick<ReplyDelivery, "visitId" | "iteration">;

/** A thread reply with the comment GitHub takes it against: the one that opened the thread. */
interface ThreadTarget {
  reply: ThreadReply;
  threadRoot: number;
}

export function replyMarker(visitId: string, iteration: number): string {
  return `<!-- lore-reply-run: ${visitId}/${iteration} -->`;
}

export function threadReplyMarker(visit: Visit, commentId: number): string {
  return `<!-- lore-reply-run: ${visit.visitId}/${visit.iteration}/${commentId} -->`;
}

export function stampedReply(
  body: string,
  visitId: string,
  iteration: number,
): string {
  return stamped(body, visitId, replyMarker(visitId, iteration));
}

export function stampedThreadReply(
  body: string,
  visit: Visit,
  commentId: number,
): string {
  return stamped(body, visit.visitId, threadReplyMarker(visit, commentId));
}

function stamped(body: string, visitId: string, marker: string): string {
  return `${body}\n\n_Posted by floor, visit ${visitId}._\n\n${marker}`;
}

export async function postReply(
  delivery: ReplyDelivery,
): Promise<ReplyPostOutcome> {
  const { poster, prNumber } = delivery;
  const body = parseReviewReply(delivery.replyOutput);

  enforceTrue(body, Error, "reply output carries no REVIEW_REPLY block");
  const [reviewComments, issueComments] = await Promise.all([
    poster.listComments(prNumber),
    poster.listIssueComments(prNumber),
  ]);
  const onPr = [...reviewComments, ...issueComments].map((c) => c.body);
  const { targets, stray } = threadTargets(
    parseThreadReplies(delivery.replyOutput),
    inlineCommentsOf(reviewComments, delivery.reviewId),
  );
  const threads = await postThreadReplies(delivery, targets, onPr);

  await resolveRepliedThreads(poster, prNumber, settledIn(targets, threads));
  const general = generalReply(body, [...stray, ...threads.refused]);
  const commented = await postGeneralReply(delivery, general, onPr);

  return threads.posted > 0 || commented ? "posted" : "already_posted";
}

/** Splits the agent's thread replies into those that answer a comment of this review and those that do not; the second kind is posted on the pull request, so nothing the agent wrote is dropped. */
function threadTargets(
  replies: ThreadReply[],
  reviewComments: ReviewComment[],
): { targets: ThreadTarget[]; stray: ThreadReply[] } {
  const rootOf = new Map(
    reviewComments.map((c) => [c.id, c.in_reply_to_id ?? c.id]),
  );

  return {
    targets: replies.flatMap((reply) => {
      const threadRoot = rootOf.get(reply.commentId);

      return threadRoot === undefined ? [] : [{ reply, threadRoot }];
    }),
    stray: replies.filter((reply) => !rootOf.has(reply.commentId)),
  };
}

/** Posts each thread reply this visit has not posted yet. One GitHub refuses (a deleted comment, a locked thread) is handed back to ride in the comment on the pull request, where failing the visit would run the agent again and post the rest twice. */
async function postThreadReplies(
  delivery: ReplyDelivery,
  targets: ThreadTarget[],
  onPr: string[],
): Promise<{ posted: number; refused: ThreadReply[] }> {
  const { poster, prNumber } = delivery;
  const due = targets.filter(
    ({ reply }) =>
      !carries(onPr, threadReplyMarker(delivery, reply.commentId)),
  );
  const results = await Promise.allSettled(
    due.map(({ reply, threadRoot }) =>
      poster.replyToReviewComment(
        prNumber,
        threadRoot,
        stampedThreadReply(reply.reply, delivery, reply.commentId),
      ),
    ),
  );
  const refused = due
    .filter((_, index) => results[index].status === "rejected")
    .map(({ reply }) => reply);

  return { posted: due.length - refused.length, refused };
}

/** The comments whose thread a pushed commit settled and whose reply is on the pull request. */
function settledIn(
  targets: ThreadTarget[],
  threads: { refused: ThreadReply[] },
): number[] {
  return targets
    .map(({ reply }) => reply)
    .filter((reply) => reply.resolved && !threads.refused.includes(reply))
    .map((reply) => reply.commentId);
}

function generalReply(body: string, unthreaded: ThreadReply[]): string {
  if (unthreaded.length === 0) {
    return body;
  }
  const answers = unthreaded.map(
    (reply) => `- comment ${reply.commentId}: ${reply.reply}`,
  );

  return `${body}\n\nAnswers that could not be posted in their thread:\n${answers.join("\n")}`;
}

async function postGeneralReply(
  delivery: ReplyDelivery,
  body: string,
  onPr: string[],
): Promise<boolean> {
  const { poster, prNumber, visitId, iteration } = delivery;

  if (carries(onPr, replyMarker(visitId, iteration))) {
    return false;
  }
  await poster.comment(prNumber, stampedReply(body, visitId, iteration));

  return true;
}

function carries(bodies: string[], marker: string): boolean {
  return bodies.some((body) => body.includes(marker));
}
