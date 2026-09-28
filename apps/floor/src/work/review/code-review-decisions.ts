// Pure decision/description helpers for the code-review choreography: no I/O, unit-tested directly.

import type {
  PullRef,
  ReviewComment,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import type { TriageAction } from "@re-cinq/lore-shared/review/comment-triage.js";
import { SKIP_CI_MARKERS } from "@re-cinq/lore-shared/project/pulls/check-runs.js";

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
// eslint-disable-next-line re-lint/no-row-types-outside-models
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

/** The re-check's brief. With the sha the last verdict judged it also names the range to read, which is the whole difference between a re-check and a second full review: a re-check that diffs `main...HEAD` re-reads the entire PR, and the ones on 2026-09-25 spent 59 commands doing it. */
export function recheckDescription(
  repo: string,
  pr: number,
  branch: string,
  sinceSha?: string,
): string {
  const scope = sinceSha
    ? ` The last verdict judged ${sinceSha}; read what changed since it with \`git -C /workspace/target diff ${sinceSha}..HEAD\`, and judge only that.`
    : "";

  return `Re-check pull request #${pr} in ${repo} (branch ${branch}) after a new push.${scope}`;
}

/** What a re-check decides from, all of it already in hand at the call site. */
export interface RecheckInput {
  /** The PR head now; absent when GitHub did not report one, where no in-flight run can be matched to it. */
  headSha?: string;
  /** Review-family runs still open on this PR, with the sha each was started for. */
  openReviewShas: readonly string[];
  /** The commit messages pushed since the last verdict, newest last; empty when the last judged sha is unknown. */
  newCommitMessages: readonly string[];
}

/** Whether a push earns its own re-check. Two pushes land within seconds of each other all day — a rebase, then the CI formatter's own commit — and each used to start a full Gemini pass: three verdicts inside four minutes on #2134, the last two judging what the first had already approved. Neither refusal here can lose a verdict: an in-flight run is judging this exact sha already, and a commit CI itself skips changes nothing a reviewer rules on. */
export function decideRecheck(input: RecheckInput): {
  start: boolean;
  reason: string;
} {
  if (
    input.headSha !== undefined &&
    input.openReviewShas.includes(input.headSha)
  ) {
    return { start: false, reason: "a review of this sha is already running" };
  }

  if (skipsCiOnly(input.newCommitMessages)) {
    return { start: false, reason: "the new commits all skip CI" };
  }

  return { start: true, reason: "new commits to judge" };
}

/** True when there ARE new commits and every one of them tells CI to skip it — the `style: prettier [skip ci]` the format job pushes onto the branch. No new commits is not this case: that is a re-trigger of the same head, which the sha guard above owns. */
function skipsCiOnly(messages: readonly string[]): boolean {
  return (
    messages.length > 0 &&
    messages.every((message) =>
      SKIP_CI_MARKERS.some((marker) => message.toLowerCase().includes(marker)),
    )
  );
}

/** Route a triaged comment; pure for unit-testability; ignore yields null. */
type TriageRoute = { definition: string; args: Record<string, unknown> } | null;

export function routeTriagedComment(
  action: TriageAction,
  ctx: CommentContext,
): TriageRoute {
  if (action === "review") {
    return reviewRoute(ctx);
  }

  // `ignore` falls through to null: not every comment is work.
  return action === "address" || action === "answer"
    ? replyRoute(action, ctx)
    : null;
}

/** A fresh review pass over the whole PR — the comment asked for the work to be redone, not discussed. */
function reviewRoute(ctx: CommentContext): TriageRoute {
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

/** A reply on one thread. `intent` carries whether the line should ANSWER the comment or COMMIT a change for it — the same definition does both, and picking per reply is what keeps a question from becoming a commit. */
function replyRoute(
  action: "address" | "answer",
  ctx: CommentContext,
): TriageRoute {
  return {
    definition: "code-review-reply",
    args: {
      pr_number: ctx.pr_number,
      head_sha: ctx.head_sha,
      comment_id: ctx.comment_id,
      in_reply_to_id: ctx.in_reply_to_id,
      comment_body: ctx.comment_body,
      mode: "reply",
      intent: action,
      actor: ctx.actor,
      description: replyDescription(action, ctx),
    },
  };
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
