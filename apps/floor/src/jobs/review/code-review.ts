/**
 * The code-review choreography (ADR-012 / assembly-lines): PR-lifecycle webhooks
 * and PR comments start short-lived assembly lines. The line itself does not
 * listen for events — all wiring lives in the Floor registry.
 *
 * Triggers (ADR-012 amendment):
 * - first review on open / out-of-draft / first push (`onTrigger`, first-review-only)
 * - explicit `@lore review` comment (`onComment` keyword fast-path)
 * - every other human comment → the Haiku `comment-triage` line, which classifies
 *   and routes (`onCommentTriaged`): review / address-and-commit / answer / ignore
 * - a formal "request changes" review → address (`onReviewSubmitted`)
 *
 * Review is suggestion-only; fixes are human-gated (the `address` intent). Gated
 * per-repo on `auto_review`; bot actors are skipped so the review never
 * re-triggers on its own output.
 */

import type { EventHandler } from "../../main-loop/types.js";
import type {
  PullRef,
  ReviewComment,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { REVIEW_HELP } from "@re-cinq/lore-shared/review/review-summary.js";
import type { TriageAction } from "@re-cinq/lore-shared/review/comment-triage.js";
import { projectFor } from "../../composition/project-boot.js";
import { shouldAutoReview } from "./should-auto-review.js";
import { loreTaskRef } from "../task/issue-body.js";

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

/**
 * Where the triage routes a classified comment. Pure so the routing table is
 * unit-testable; `ignore` yields null (no follow-up line, only the triage pod ran).
 */
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
        description: replyDescription(action, ctx),
      },
    };
  }

  return null;
}

function reviewDescription(repo: string, pr: number, branch: string): string {
  return `Review pull request #${pr} in ${repo} (branch ${branch}).`;
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

/** The narrow project surface the handlers touch — kept minimal so tests use light doubles. */
export interface CodeReviewProject {
  pulls: {
    get(number: number): Promise<PullRef | null>;
    comment(number: number, body: string): Promise<void>;
    listComments(number: number): Promise<ReviewComment[]>;
  };
  assemblyLines: {
    start(
      definitionName: string,
      opts: { branch?: string; args?: Record<string, unknown> },
    ): Promise<string>;
    finishOpenByPr(prNumber: number, outcome: string): Promise<number>;
    hasReviewedPr(prNumber: number): Promise<boolean>;
  };
}

export interface CodeReviewDeps {
  project(repo: string): Promise<CodeReviewProject>;
  autoReview(repo: string): Promise<boolean>;
  uiUrl(): string | undefined;
}

interface OpenParams {
  repo: string;
  pr_number: number;
}
interface CommentParams extends OpenParams {
  comment_id: number;
  comment_author: string;
  comment_body: string;
  in_reply_to_id?: number | null;
}
interface ReviewSubmittedParams extends OpenParams {
  review_id?: number | null;
  review_state?: string;
  review_author?: string;
  review_body?: string;
}

/**
 * The actual feedback of a submitted review: its body plus every inline comment
 * (with ids so the reply agent can target each thread). Pure; empty when the
 * review carried neither.
 */
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

/** The thread context threaded from a comment into the triage + follow-up lines. */
export interface CommentContext {
  repo: string;
  pr_number: number;
  branch: string;
  head_sha?: string;
  comment_id: number;
  comment_body: string;
  in_reply_to_id?: number | null;
}

/**
 * Start a `code-review` line (mode `review`) and post the how-to started comment.
 * `forced` bypasses the auto-review gate (explicit human intent: the `@lore review`
 * keyword, the manual UI button, or a triage `review` route). Returns the line id
 * or null when the gate/PR check skips it.
 */
export async function startReview(
  project: CodeReviewProject,
  input: {
    repo: string;
    prNumber: number;
    autoReview: boolean;
    forced?: boolean;
  },
  uiUrl?: string,
): Promise<string | null> {
  const pr = await project.pulls.get(input.prNumber);

  if (!pr || pr.state !== "open") {
    return null;
  }

  if (
    !input.forced &&
    !decideReviewOnOpen({ autoReview: input.autoReview, pr }).start
  ) {
    return null;
  }
  const id = await project.assemblyLines.start("code-review", {
    branch: pr.branch,
    args: {
      pr_number: input.prNumber,
      mode: "review",
      head_sha: pr.headSha,
      description: reviewDescription(input.repo, input.prNumber, pr.branch),
    },
  });

  await project.pulls.comment(
    input.prNumber,
    `Lore is reviewing this PR — ${loreTaskRef(id, uiUrl)}.\n\n${REVIEW_HELP}`,
  );

  return id;
}

export function createCodeReviewHandlers(deps: CodeReviewDeps): {
  onTrigger: EventHandler;
  onComment: EventHandler;
  onReviewSubmitted: EventHandler;
  onCommentTriaged: EventHandler;
  onClose: EventHandler;
} {
  const onTrigger: EventHandler = async (params) => {
    const { repo, pr_number } = params as unknown as OpenParams;
    const autoReview = await deps.autoReview(repo);

    if (!autoReview) {
      return;
    }
    const project = await deps.project(repo);

    // First-review-only: opened/ready_for_review/synchronize should review once;
    // subsequent pushes don't re-review (re-review is an explicit `@lore review`).
    if (await project.assemblyLines.hasReviewedPr(pr_number)) {
      return;
    }
    await startReview(
      project,
      { repo, prNumber: pr_number, autoReview },
      deps.uiUrl(),
    );
  };

  const onComment: EventHandler = async (params) => {
    const p = params as unknown as CommentParams;
    const autoReview = await deps.autoReview(p.repo);

    if (!autoReview || isBotActor(p.comment_author)) {
      return; // loop guard before any API call
    }
    const project = await deps.project(p.repo);
    const pr = await project.pulls.get(p.pr_number);

    if (
      !decideReviewOnReply({ autoReview, pr, commentAuthor: p.comment_author })
        .start
    ) {
      return;
    }

    // Explicit keyword bypasses the triage — deterministic re-review.
    if (isReviewRequest(p.comment_body)) {
      await startReview(
        project,
        { repo: p.repo, prNumber: p.pr_number, autoReview, forced: true },
        deps.uiUrl(),
      );

      return;
    }
    // Everything else → the Haiku triage line, which classifies + routes.
    const ctx = commentContext(p, pr!);

    await project.assemblyLines.start("comment-triage", {
      branch: pr!.branch,
      args: { ...ctx, mode: "triage", description: triageDescription(ctx) },
    });
  };

  const onReviewSubmitted: EventHandler = async (params) => {
    const p = params as unknown as ReviewSubmittedParams;
    const autoReview = await deps.autoReview(p.repo);

    if (!autoReview) {
      return;
    }

    // Only a "request changes" review is a work order — approvals and comment
    // reviews must not spawn an address line.
    if ((p.review_state ?? "changes_requested") !== "changes_requested") {
      return;
    }
    const project = await deps.project(p.repo);
    const pr = await project.pulls.get(p.pr_number);
    const author = p.review_author ?? "";

    if (!decideReviewOnReply({ autoReview, pr, commentAuthor: author }).start) {
      return;
    }
    const inline = p.review_id
      ? (await project.pulls.listComments(p.pr_number)).filter(
          (c) => c.review_id === p.review_id,
        )
      : [];
    const feedback = reviewFeedback(p.review_body ?? "", inline);
    const ctx: CommentContext = {
      repo: p.repo,
      pr_number: p.pr_number,
      branch: pr!.branch,
      head_sha: pr!.headSha,
      comment_id: 0,
      comment_body: feedback || "changes requested in a submitted review",
    };
    const route = routeTriagedComment("address", ctx)!;

    await project.assemblyLines.start(route.definition, {
      branch: pr!.branch,
      args: route.args,
    });
  };

  /** Route a finished comment-triage line's action to the follow-up line. */
  const onCommentTriaged: EventHandler = async (params) => {
    const action = String(params.action ?? "ignore") as TriageAction;
    const ctx = params.context as CommentContext | undefined;

    if (!ctx) {
      return;
    }
    const route = routeTriagedComment(action, ctx);

    if (!route) {
      return;
    }
    const project = await deps.project(ctx.repo);

    await project.assemblyLines.start(route.definition, {
      branch: ctx.branch,
      args: route.args,
    });
  };

  const onClose: EventHandler = async (params) => {
    const { repo, pr_number } = params as unknown as OpenParams;
    const project = await deps.project(repo);

    await project.assemblyLines.finishOpenByPr(pr_number, "pr_closed");
  };

  return { onTrigger, onComment, onReviewSubmitted, onCommentTriaged, onClose };
}

function commentContext(p: CommentParams, pr: PullRef): CommentContext {
  return {
    repo: p.repo,
    pr_number: p.pr_number,
    branch: pr.branch,
    head_sha: pr.headSha,
    comment_id: p.comment_id,
    comment_body: p.comment_body,
    in_reply_to_id: p.in_reply_to_id ?? null,
  };
}

function triageDescription(ctx: CommentContext): string {
  return `Triage a human comment on pull request #${ctx.pr_number} in ${ctx.repo}: ${ctx.comment_body}`;
}

const handlers = createCodeReviewHandlers({
  project: (repo) => projectFor(repo),
  autoReview: shouldAutoReview,
  uiUrl: () => process.env.LORE_UI_URL,
});

export const codeReviewOnTrigger = handlers.onTrigger;
export const codeReviewOnComment = handlers.onComment;
export const codeReviewOnReviewSubmitted = handlers.onReviewSubmitted;
export const codeReviewOnCommentTriaged = handlers.onCommentTriaged;
export const codeReviewOnClose = handlers.onClose;
