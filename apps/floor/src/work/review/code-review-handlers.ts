// The PR-lifecycle handlers: which webhook starts, joins, or finishes a review line. Separate from code-review.ts, which owns STARTING one — this half grows with GitHub's event surface, that half with the review itself.

import type { TriageAction } from "@re-cinq/lore-shared/review/comment-triage.js";
import { REVIEW_DEFINITIONS } from "@re-cinq/lore-shared/review/review-definitions.js";
import { projectFor } from "../../outbound/project-boot.js";
import { shouldAutoReview } from "../../outbound/should-auto-review.js";
import { cleanupPerTaskToken } from "../../outbound/per-task-token.js";
import type { EventHandler } from "../../domain/event-types.js";
import {
  startReview,
  startRecheck,
  inlineReviewComments,
  type CodeReviewDeps,
  type CodeReviewProject,
  type CommentParams,
  type OpenParams,
  type ReviewSubmittedParams,
} from "./code-review.js";
import {
  decideReviewOnReply,
  isBotActor,
  isReviewRequest,
  isChangesRequestedReview,
  reviewSubmittedFeedback,
  routeTriagedComment,
  type CommentContext,
} from "./code-review-decisions.js";
import type {
  PullRef,
  ReviewComment,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

export function createCodeReviewHandlers(deps: CodeReviewDeps): {
  onTrigger: EventHandler;
  onComment: EventHandler;
  onReviewSubmitted: EventHandler;
  onCommentTriaged: EventHandler;
  onClose: EventHandler;
} {
  return {
    onTrigger: onTrigger(deps),
    onComment: onComment(deps),
    onReviewSubmitted: onReviewSubmitted(deps),
    onCommentTriaged: onCommentTriaged(deps),
    onClose: onClose(deps),
  };
}

/** A PR opened or pushed to. The first push gets a deep review; later pushes get a fast re-check with an updated verdict. */
function onTrigger(deps: CodeReviewDeps): EventHandler {
  return async (params) => {
    const { repo, pr_number } = params as unknown as OpenParams;
    const autoReview = await deps.autoReview(repo);

    if (!autoReview) {
      return;
    }
    const project = await deps.project(repo);

    // First push = deep review; later pushes = fast re-check with updated verdict
    if (await project.assemblyRuns.hasReviewedPr(pr_number)) {
      await startRecheck(project, { repo, prNumber: pr_number, autoReview });

      return;
    }
    await startReview(
      project,
      { repo, prNumber: pr_number, autoReview },
      deps.uiUrl(),
    );
  };
}

async function replyGateOpen(
  project: CodeReviewProject,
  p: CommentParams,
  autoReview: boolean,
): Promise<boolean> {
  const pr = await project.pulls.get(p.pr_number);

  return decideReviewOnReply({
    autoReview,
    pr,
    commentAuthor: p.comment_author,
  }).start;
}

async function startForcedReview(
  project: CodeReviewProject,
  p: CommentParams,
  autoReview: boolean,
  uiUrl: string | undefined,
): Promise<void> {
  await startReview(
    project,
    {
      repo: p.repo,
      prNumber: p.pr_number,
      autoReview,
      forced: true,
      actor: p.comment_author,
    },
    uiUrl,
  );
}

/** A human comment. Bot authors are skipped before any API call — that guard is the loop breaker. */
function onComment(deps: CodeReviewDeps): EventHandler {
  return async (params) => {
    const p = params as unknown as CommentParams;
    const autoReview = await deps.autoReview(p.repo);

    if (!autoReview || isBotActor(p.comment_author)) {
      return; // loop guard before any API call
    }
    const project = await deps.project(p.repo);

    if (!(await replyGateOpen(project, p, autoReview))) {
      return;
    }

    // The Haiku `comment-triage` line is switched off (2026-09-03): only the explicit keyword drives a comment, so a plain reply publishes no `lore/comment-triage` check.
    if (isReviewRequest(p.comment_body)) {
      await startForcedReview(project, p, autoReview, deps.uiUrl());
    }
  };
}

function addressContext(
  p: ReviewSubmittedParams,
  pr: PullRef,
  author: string,
  inline: ReviewComment[],
): CommentContext {
  return {
    repo: p.repo,
    pr_number: p.pr_number,
    branch: pr.branch,
    head_sha: pr.headSha,
    comment_id: 0,
    comment_body:
      reviewSubmittedFeedback(p.review_body, inline) ||
      "changes requested in a submitted review",
    actor: author,
  };
}

/** A submitted request-changes review becomes an `address` work order. The review's own body and its inline comments are gathered into ONE feedback text — the agent gets the whole objection, not just whichever half the reviewer typed where. */
async function startAddressLine(
  project: CodeReviewProject,
  p: ReviewSubmittedParams,
  pr: PullRef,
  author: string,
): Promise<void> {
  const inline = await inlineReviewComments(project, p.pr_number, p.review_id);
  const route = routeTriagedComment(
    "address",
    addressContext(p, pr, author, inline),
  )!;

  await project.assemblyRuns.start(route.definition, {
    branch: pr.branch,
    args: route.args,
  });
}

/** A submitted review. Only a request-changes review spawns a work order; an approval needs no follow-up line. */
function onReviewSubmitted(deps: CodeReviewDeps): EventHandler {
  return async (params) => {
    const p = params as unknown as ReviewSubmittedParams;
    const autoReview = await deps.autoReview(p.repo);

    if (!autoReview) {
      return;
    }

    // Only "request changes" reviews spawn a work order
    if (!isChangesRequestedReview(p.review_state)) {
      return;
    }
    const project = await deps.project(p.repo);
    const pr = await project.pulls.get(p.pr_number);
    const author = p.review_author ?? "";

    if (!decideReviewOnReply({ autoReview, pr, commentAuthor: author }).start) {
      return;
    }
    await startAddressLine(project, p, pr!, author);
  };
}

/** Route a finished comment-triage line's action to the follow-up line. */
function onCommentTriaged(deps: CodeReviewDeps): EventHandler {
  return async (params) => {
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

    await project.assemblyRuns.start(route.definition, {
      branch: ctx.branch,
      args: route.args,
    });
  };
}

function onClose(deps: CodeReviewDeps): EventHandler {
  return async (params) => {
    const { repo, pr_number } = params as unknown as OpenParams;
    const project = await deps.project(repo);

    // Only close this choreography's lines to prevent closing spec PRs on FEATURE-PLANNING
    const closed = await project.assemblyRuns.finishOpenByPr(
      pr_number,
      "pr_closed",
      REVIEW_DEFINITIONS,
    );

    // Cleanup per-run token; without it PRs closed mid-review left GH_TOKEN_* keys (fleet outage 2026-08-25)
    await Promise.all(
      closed.map((run) => deps.cleanupToken(run.taskId ?? run.id)),
    );
  };
}

const handlers = createCodeReviewHandlers({
  project: (repo) => projectFor(repo),
  autoReview: shouldAutoReview,
  uiUrl: () => process.env.LORE_UI_URL,
  cleanupToken: cleanupPerTaskToken,
});

export const codeReviewOnTrigger = handlers.onTrigger;
export const codeReviewOnComment = handlers.onComment;
export const codeReviewOnReviewSubmitted = handlers.onReviewSubmitted;
export const codeReviewOnCommentTriaged = handlers.onCommentTriaged;
export const codeReviewOnClose = handlers.onClose;
