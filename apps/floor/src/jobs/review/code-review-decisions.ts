// Pure decision/description helpers for the code-review choreography: no I/O, unit-tested directly.

import type {
  PullRef,
  ReviewComment,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import type { TriageAction } from "@re-cinq/lore-shared/review/comment-triage.js";

/** A GitHub App / bot login ends with `[bot]`; only human actors drive the review. */
export function isBotActor(login: string): boolean {
  return login.endsWith("[bot]");
}

/** An explicit request to (re)review — the deterministic fast-path past the triage. */
export function isReviewRequest(body: string): boolean {
  return /(^|\s)[@/]?lore\s+review\b/i.test(body);
}

export function decideReviewOnOpen(input: {
  autoReview: boolean;
  pr: PullRef | null;
}): { start: boolean } {
  const { autoReview, pr } = input;

  return {
    start:
      autoReview &&
      !!pr &&
      pr.state === "open" &&
      pr.draft !== true &&
      !isBotActor(pr.author ?? ""),
  };
}

export function decideReviewOnReply(input: {
  autoReview: boolean;
  pr: PullRef | null;
  commentAuthor: string;
}): { start: boolean } {
  const { autoReview, pr, commentAuthor } = input;

  return {
    start:
      autoReview &&
      !!pr &&
      pr.state === "open" &&
      pr.draft !== true &&
      !isBotActor(commentAuthor),
  };
}

// The thread context threaded through pipeline.events "context" args (comment-triage → follow-up line), GitHub-shaped.
// eslint-disable-next-line lore/no-row-types-outside-models
export interface CommentContext {
  repo: string;
  pr_number: number;
  branch: string;
  head_sha?: string;
  comment_id: number;
  comment_body: string;
  in_reply_to_id?: number | null;
  /** The human who triggered the line; surfaced as the "By" for task-less lines. */
  actor?: string;
}

export function reviewDescription(
  repo: string,
  pr: number,
  branch: string,
): string {
  return `Review pull request #${pr} in ${repo} (branch ${branch}).`;
}

export function recheckDescription(
  repo: string,
  pr: number,
  branch: string,
): string {
  return `Re-check pull request #${pr} in ${repo} (branch ${branch}) after a new push.`;
}

function replyDescription(
  intent: "address" | "answer",
  ctx: CommentContext,
): string {
  const thread = ctx.in_reply_to_id
    ? ` (reply on review-comment thread ${ctx.in_reply_to_id})`
    : "";
  const head = `On pull request #${ctx.pr_number} in ${ctx.repo} (branch ${ctx.branch})${thread}, a human commented: ${ctx.comment_body}`;

  return intent === "address"
    ? `${head}\n\nThey approved a fix — implement it and commit to the PR branch, then confirm briefly in the thread.`
    : `${head}\n\nAnswer their question briefly in the review thread; do not change code.`;
}

/** Route a triaged comment; pure for unit-testability; ignore yields null. */
export function routeTriagedComment(
  action: TriageAction,
  ctx: CommentContext,
): { definition: string; args: Record<string, unknown> } | null {
  const thread = {
    pr_number: ctx.pr_number,
    head_sha: ctx.head_sha,
    comment_id: ctx.comment_id,
    in_reply_to_id: ctx.in_reply_to_id,
    comment_body: ctx.comment_body,
  };

  if (action === "review") {
    return {
      definition: "code-review",
      args: {
        pr_number: ctx.pr_number,
        head_sha: ctx.head_sha,
        mode: "review",
        actor: ctx.actor,
        description: reviewDescription(ctx.repo, ctx.pr_number, ctx.branch),
      },
    };
  }

  if (action === "address" || action === "answer") {
    return {
      definition: "code-review-reply",
      args: {
        ...thread,
        mode: "reply",
        intent: action,
        actor: ctx.actor,
        description: replyDescription(action, ctx),
      },
    };
  }

  return null;
}

/** Review feedback: body plus inline comments with ids for thread targeting. */
export function reviewFeedback(
  body: string,
  comments: ReviewComment[],
): string {
  const lines = comments.map((c) => {
    const where = c.line === null ? c.path : `${c.path}:${c.line}`;

    return `- inline comment ${c.id} on ${where}: ${c.body}`;
  });
  const trimmed = body.trim();

  if (lines.length === 0) {
    return trimmed;
  }
  const inline = `Inline comments:\n${lines.join("\n")}`;

  return trimmed ? `${trimmed}\n\n${inline}` : inline;
}

/** True once the PR is open and either forced or the auto-review gate says go. */
export function reviewGateOpen(
  pr: PullRef,
  input: { autoReview: boolean; forced?: boolean },
): boolean {
  if (pr.state !== "open") {
    return false;
  }

  return (
    input.forced ||
    decideReviewOnOpen({ autoReview: input.autoReview, pr }).start
  );
}

/** Only a "request changes" review spawns a work order; an unset state defaults to that. */
export function isChangesRequestedReview(
  reviewState: string | undefined,
): boolean {
  return (reviewState ?? "changes_requested") === "changes_requested";
}

/** Formats a submitted review's body + inline comments, falling back when there is no text. */
export function reviewSubmittedFeedback(
  body: string | undefined,
  inline: ReviewComment[],
): string {
  return (
    reviewFeedback(body ?? "", inline) ||
    "changes requested in a submitted review"
  );
}
