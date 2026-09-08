/** Code-review choreography (ADR-012): PR-lifecycle webhooks start assembly lines; bot actors skipped. */

import type {
  PullRef,
  ReviewComment,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { REVIEW_HELP } from "@re-cinq/lore-shared/review/review-summary.js";
import { loreTaskRef } from "../../domain/task-ref.js";
import { reviewSubject } from "@re-cinq/lore-shared/project/assembly-runs/subject-keys.js";

import type { ClosedRunRef } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import {
  decideReviewOnOpen,
  recheckDescription,
  reviewDescription,
  reviewGateOpen,
} from "./code-review-decisions.js";

// Re-exported so callers (and the handlers module) have one import site for the review decisions.
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

export interface OpenParams {
  repo: string;
  pr_number: number;
}
// The `pipeline.events` args for a github.issue_comment/pull_request_review_comment row (github-map.ts), GitHub-shaped.
// eslint-disable-next-line re-lint/no-row-types-outside-models
export interface CommentParams extends OpenParams {
  comment_id: number;
  comment_author: string;
  comment_body: string;
  in_reply_to_id?: number | null;
}
// The `pipeline.events` args for a github.pull_request_review.submitted row (github-map.ts), GitHub-shaped.
// eslint-disable-next-line re-lint/no-row-types-outside-models
export interface ReviewSubmittedParams extends OpenParams {
  review_id?: number | null;
  review_state?: string;
  review_author?: string;
  review_body?: string;
}

/** Start a code-review line and post the how-to comment; forced bypasses auto-review gate. */
/** Starts the review line and reports whether this call JOINED a run that was already open. Check-then-act rather than a CAS: the only thing riding on the answer is whether to post the announcement comment, and a duplicate comment is the failure being avoided. The subject key is the PR, not the branch — recheck, reply and triage lines share one workspace. */
async function startReviewLine(
  project: CodeReviewProject,
  input: { repo: string; prNumber: number; actor?: string },
  pr: PullRef,
): Promise<{ id: string; joined: boolean }> {
  const subjectKey = reviewSubject(input.prNumber);
  const alreadyOpen = await project.assemblyRuns.findOpenBySubject(subjectKey);
  const id = await project.assemblyRuns.start("code-review", {
    branch: pr.branch,
    subjectKey,
    args: {
      pr_number: input.prNumber,
      mode: "review",
      head_sha: pr.headSha,
      actor: input.actor ?? pr.author,
      description: reviewDescription(input.repo, input.prNumber, pr.branch),
    },
  });

  return { id, joined: alreadyOpen?.id === id };
}

export interface StartReviewInput {
  repo: string;
  prNumber: number;
  autoReview: boolean;
  forced?: boolean;
  actor?: string;
}

async function announceReview(
  project: CodeReviewProject,
  prNumber: number,
  runId: string,
  uiUrl?: string,
): Promise<void> {
  await project.pulls.comment(
    prNumber,
    `Lore is reviewing this PR — ${loreTaskRef(runId, uiUrl)}.\n\n${REVIEW_HELP}`,
  );
}

export async function startReview(
  project: CodeReviewProject,
  input: StartReviewInput,
  uiUrl?: string,
): Promise<string | null> {
  const pr = await project.pulls.get(input.prNumber);

  if (!pr || !reviewGateOpen(pr, input)) {
    return null;
  }
  const started = await startReviewLine(project, input, pr);

  // A JOINed run was announced when it started; announcing again posts a duplicate comment.
  if (!started.joined) {
    await announceReview(project, input.prNumber, started.id, uiUrl);
  }

  return started.id;
}

function recheckArgs(
  repo: string,
  prNumber: number,
  pr: PullRef,
): Record<string, unknown> {
  return {
    pr_number: prNumber,
    mode: "recheck",
    head_sha: pr.headSha,
    actor: pr.author,
    description: recheckDescription(repo, prNumber, pr.branch),
  };
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
    args: recheckArgs(input.repo, input.prNumber, pr),
  });
}

/** Inline review comments belonging to one review, or none when the review carries no id. */
export async function inlineReviewComments(
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
