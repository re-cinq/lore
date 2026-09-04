/** Code-review choreography (ADR-012): PR-lifecycle webhooks start assembly lines; bot actors skipped. */

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
import { reviewSubject } from "@re-cinq/lore-shared/project/assembly-runs/subject-keys.js";

import { REVIEW_DEFINITIONS } from "@re-cinq/lore-shared/review/review-definitions.js";
import type { ClosedRunRef } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { cleanupPerTaskToken } from "../watcher/agent-watcher.js";
import {
  decideReviewOnOpen,
  decideReviewOnReply,
  isBotActor,
  isChangesRequestedReview,
  isReviewRequest,
  recheckDescription,
  reviewDescription,
  reviewGateOpen,
  reviewSubmittedFeedback,
  routeTriagedComment,
  type CommentContext,
} from "./code-review-decisions.js";

export {
  decideReviewOnOpen,
  decideReviewOnReply,
  isBotActor,
  isReviewRequest,
  reviewFeedback,
  routeTriagedComment,
  type CommentContext,
} from "./code-review-decisions.js";

/** The narrow project surface the handlers touch — kept minimal so tests use light doubles. */
export interface CodeReviewProject {
  pulls: {
    get(number: number): Promise<PullRef | null>;
    comment(number: number, body: string): Promise<void>;
    listComments(number: number): Promise<ReviewComment[]>;
  };
  assemblyRuns: {
    start(
      blueprintName: string,
      opts: {
        branch?: string;
        subjectKey?: string;
        args?: Record<string, unknown>;
      },
    ): Promise<string>;
    findOpenBySubject(subjectKey: string): Promise<{ id: string } | null>;
    finishOpenByPr(
      prNumber: number,
      outcome: string,
      definitions?: readonly string[],
    ): Promise<ClosedRunRef[]>;
    hasReviewedPr(prNumber: number): Promise<boolean>;
  };
}

export interface CodeReviewDeps {
  project(repo: string): Promise<CodeReviewProject>;
  autoReview(repo: string): Promise<boolean>;
  uiUrl(): string | undefined;
  /** Reclaim per-run token/definition; needed because PR close bypasses finishLine. */
  cleanupToken(key: string): Promise<void>;
}

interface OpenParams {
  repo: string;
  pr_number: number;
}
// The `pipeline.events` args for a github.issue_comment/pull_request_review_comment row (github-map.ts), GitHub-shaped.
// eslint-disable-next-line lore/no-row-types-outside-models
interface CommentParams extends OpenParams {
  comment_id: number;
  comment_author: string;
  comment_body: string;
  in_reply_to_id?: number | null;
}
// The `pipeline.events` args for a github.pull_request_review.submitted row (github-map.ts), GitHub-shaped.
// eslint-disable-next-line lore/no-row-types-outside-models
interface ReviewSubmittedParams extends OpenParams {
  review_id?: number | null;
  review_state?: string;
  review_author?: string;
  review_body?: string;
}

/** Start a code-review line and post the how-to comment; forced bypasses auto-review gate. */
export async function startReview(
  project: CodeReviewProject,
  input: {
    repo: string;
    prNumber: number;
    autoReview: boolean;
    forced?: boolean;
    actor?: string;
  },
  uiUrl?: string,
): Promise<string | null> {
  const pr = await project.pulls.get(input.prNumber);

  if (!pr || !reviewGateOpen(pr, input)) {
    return null;
  }
  const subjectKey = reviewSubject(input.prNumber);
  // Check-then-act to detect JOINs and avoid redundant announcements; only this message needs it
  const alreadyOpen = await project.assemblyRuns.findOpenBySubject(subjectKey);
  const id = await project.assemblyRuns.start("code-review", {
    branch: pr.branch,
    // Subject key on PR, not branch (shared workspace across recheck/reply/triage lines)
    subjectKey,
    args: {
      pr_number: input.prNumber,
      mode: "review",
      head_sha: pr.headSha,
      actor: input.actor ?? pr.author,
      description: reviewDescription(input.repo, input.prNumber, pr.branch),
    },
  });

  // JOIN runs were announced when started; announcing again posts duplicate comments
  if (alreadyOpen?.id === id) {
    return id;
  }

  await project.pulls.comment(
    input.prNumber,
    `Lore is reviewing this PR — ${loreTaskRef(id, uiUrl)}.\n\n${REVIEW_HELP}`,
  );

  return id;
}

/** Fast re-check for pushes after initial review; BRANCH_SHARED_WORKSPACE prevents lease_held drops. */
export async function startRecheck(
  project: CodeReviewProject,
  input: { repo: string; prNumber: number; autoReview: boolean },
): Promise<string | null> {
  const pr = await project.pulls.get(input.prNumber);

  if (!pr || pr.state !== "open") {
    return null;
  }

  if (!decideReviewOnOpen({ autoReview: input.autoReview, pr }).start) {
    return null;
  }

  return project.assemblyRuns.start("code-review-recheck", {
    branch: pr.branch,
    args: {
      pr_number: input.prNumber,
      mode: "recheck",
      head_sha: pr.headSha,
      actor: pr.author,
      description: recheckDescription(input.repo, input.prNumber, pr.branch),
    },
  });
}

/** Inline review comments belonging to one review, or none when the review carries no id. */
async function inlineReviewComments(
  project: CodeReviewProject,
  prNumber: number,
  reviewId: number | null | undefined,
): Promise<ReviewComment[]> {
  if (!reviewId) {
    return [];
  }
  const comments = await project.pulls.listComments(prNumber);

  return comments.filter((c) => c.review_id === reviewId);
}

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

/** A human comment. Bot authors are skipped before any API call — that guard is the loop breaker. */
function onComment(deps: CodeReviewDeps): EventHandler {
  return async (params) => {
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

    // The Haiku `comment-triage` line is switched off (2026-09-03): only the explicit keyword drives a comment, so a plain reply publishes no `lore/comment-triage` check.
    if (!isReviewRequest(p.comment_body)) {
      return;
    }
    await startReview(
      project,
      {
        repo: p.repo,
        prNumber: p.pr_number,
        autoReview,
        forced: true,
        actor: p.comment_author,
      },
      deps.uiUrl(),
    );
  };
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
    const inline = await inlineReviewComments(
      project,
      p.pr_number,
      p.review_id,
    );
    const feedback = reviewSubmittedFeedback(p.review_body, inline);
    const ctx: CommentContext = {
      repo: p.repo,
      pr_number: p.pr_number,
      branch: pr!.branch,
      head_sha: pr!.headSha,
      comment_id: 0,
      comment_body: feedback || "changes requested in a submitted review",
      actor: author,
    };
    const route = routeTriagedComment("address", ctx)!;

    await project.assemblyRuns.start(route.definition, {
      branch: pr!.branch,
      args: route.args,
    });
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
