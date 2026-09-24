// The spec PR's review as the spec writer reads it (specs/7-feature-planning, "Rework from the spec review"): the unresolved inline threads and the submitted review bodies, gathered once by lore-api when a person asks for the rework and carried on the run's args as `spec_review`; and the writer's answer, `spec-review-result.json`, which the Floor turns into plan questions and PR replies.

import { z } from "zod";
import type {
  PullReview,
  ReviewComment,
  ReviewThread,
} from "../../outbound/project/pulls/pull-requests-port.js";

/** The arg the review rides on; the writer's prompt block is appended from it. */
export const SPEC_REVIEW_ARG = "spec_review";
/** Set by the Floor when the writer sent questions to the plan: the next park on the PR wait reopens the plan. */
export const SPEC_REVIEW_REOPEN_ARG = "spec_review_reopen";
/** The artifact event the writer's answer arrives as; `argNameForEvent` would make it `spec_review_result`, but it is owned by the Floor's delivery, never merged into args. */
export const SPEC_REVIEW_RESULT_EVENT = "spec.review.result";

const specReviewCommentSchema = z.object({
  id: z.number(),
  path: z.string(),
  line: z.number().nullable(),
  author: z.string(),
  body: z.string(),
});

const specReviewBodySchema = z.object({
  id: z.number(),
  author: z.string(),
  state: z.string(),
  body: z.string(),
});

export const specReviewSchema = z.object({
  pr_number: z.number(),
  reviews: z.array(specReviewBodySchema),
  comments: z.array(specReviewCommentSchema),
});

export type SpecReview = z.infer<typeof specReviewSchema>;

/** What the writer answers per comment: it changed the specs, or it sent the matter to the plan. */
export const specReviewResultSchema = z.object({
  plan_questions: z.array(
    z.object({
      slot: z.string().min(1),
      question: z.string().min(1),
      why: z.string().default(""),
    }),
  ),
  replies: z.array(
    z.object({
      comment_id: z.number(),
      action: z.enum(["addressed", "to_plan"]),
      note: z.string().default(""),
    }),
  ),
});

export type SpecReviewResult = z.infer<typeof specReviewResultSchema>;

/** The review as the rework carries it: inline comments whose thread nobody resolved (outdated ones included — a comment on a line the push moved is still a comment), and every submitted review that said something. Pure; the reads are the caller's. */
export function specReviewOf(
  prNumber: number,
  reads: {
    threads: readonly ReviewThread[];
    comments: readonly ReviewComment[];
    reviews: readonly PullReview[];
  },
): SpecReview {
  const open = unresolvedCommentIds(reads.threads);
  const { reviews, comments } = reads;
  const spoken = reviews.filter(saidSomething);
  const unresolved = comments.filter((comment) => open.has(comment.id));

  return {
    pr_number: prNumber,
    reviews: spoken.map(reviewBodyOf),
    comments: unresolved.map(inlineCommentOf),
  };
}

function unresolvedCommentIds(threads: readonly ReviewThread[]): Set<number> {
  const unresolved = threads.filter((thread) => !thread.isResolved);
  const ids = unresolved.flatMap((thread) => thread.comments);

  return new Set(
    ids.flatMap((c) => (c.databaseId === null ? [] : [c.databaseId])),
  );
}

function saidSomething(review: PullReview): boolean {
  return review.body.trim() !== "";
}

function reviewBodyOf(review: PullReview): SpecReview["reviews"][number] {
  const { id, user, state, body } = review;

  return { id, author: user, state, body: body.trim() };
}

function inlineCommentOf(
  comment: ReviewComment,
): SpecReview["comments"][number] {
  const { id, path, line, user, body } = comment;

  return { id, path, line, author: user, body: body.trim() };
}

/** The review the run's args carry, or null when none was gathered, or what was stored does not parse. */
export function specReviewFromArgs(
  args: Readonly<Record<string, unknown>>,
): SpecReview | null {
  const raw = args[SPEC_REVIEW_ARG];
  const value = typeof raw === "string" ? parseJson(raw) : raw;
  const parsed = specReviewSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** True when the review holds anything a writer could act on. */
export function specReviewIsEmpty(review: SpecReview): boolean {
  return review.reviews.length === 0 && review.comments.length === 0;
}

/** The block appended to the writer's prompt: every review body, then every open inline comment with the id the writer answers by. */
export function renderSpecReview(review: SpecReview): string {
  const reviews = review.reviews.map(
    (r) => `- review ${r.id} by ${r.author} (${r.state}): ${r.body}`,
  );
  const comments = review.comments.map(
    (c) =>
      `- comment ${c.id} on ${c.path}${c.line === null ? "" : `:${c.line}`} by ${c.author}: ${c.body}`,
  );

  return [
    `## The spec review said`,
    "",
    `Spec PR #${review.pr_number} is under review. Every item below is open. Answer each one in spec-review-result.json by its id.`,
    "",
    ...(reviews.length ? ["Reviews:", ...reviews, ""] : []),
    ...(comments.length ? ["Inline comments:", ...comments] : []),
  ]
    .join("\n")
    .trimEnd();
}
