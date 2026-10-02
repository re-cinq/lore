/** Structured output contract for the code-review-refine `reply` node: the agent emits a fenced ` ```REVIEW_REPLY ` block (no `gh`/shell token in-pod), the Floor posts it via PullRequestsPort; absent/empty block yields `null`. A second, optional ` ```REVIEW_THREAD_REPLIES ` block answers the review's line comments one by one. */
import { z } from "zod";

const REPLY_BLOCK = /```REVIEW_REPLY\s*\n([\s\S]*?)```/;
const THREAD_REPLIES_BLOCK = /```REVIEW_THREAD_REPLIES\s*\n([\s\S]*?)```/;

const threadRepliesSchema = z.array(
  z
    .object({
      comment_id: z.number().int().positive(),
      reply: z.string().trim().min(1),
      resolved: z.boolean().optional(),
    })
    .transform(({ comment_id: commentId, reply, resolved }) => ({
      commentId,
      reply,
      resolved: resolved === true,
    })),
);

/** The answer to one line comment of the review, and whether a pushed commit settled it. */
export type ThreadReply = z.infer<typeof threadRepliesSchema>[number];

export function parseReviewReply(output: string): string | null {
  const match = output.match(REPLY_BLOCK);

  if (!match) {
    return null;
  }
  const body = match[1].trim();

  return body.length > 0 ? body : null;
}

/** A block that is missing, not JSON or not the declared shape reads as no thread replies: the overall reply still posts. */
export function parseThreadReplies(output: string): ThreadReply[] {
  const block = output.match(THREAD_REPLIES_BLOCK)?.[1] ?? "[]";

  return threadRepliesSchema.safeParse(parseJson(block)).data ?? [];
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
