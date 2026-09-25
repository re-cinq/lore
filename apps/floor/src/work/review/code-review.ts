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
  decideRecheck,
  decideReviewOnOpen,
  recheckDescription,
  reviewDescription,
  reviewGateOpen,
} from "./code-review-decisions.js";
import { REVIEW_DEFINITIONS } from "@re-cinq/lore-shared/review/review-definitions.js";

// Re-exported so callers (and the handlers module) have one import site for the review decisions.
export {
  decideRecheck,
  decideReviewOnOpen,
  recheckDescription,
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
    /** Oldest first, as GitHub lists them. */
    listCommits(
      number: number,
    ): Promise<Array<{ sha: string; message: string }>>;
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
    findOpenByPr(
      prNumber: number,
    ): Promise<Array<{ blueprintName: string; args: Record<string, unknown> }>>;
    listForPr(
      prNumber: number,
      definitions?: readonly string[],
    ): Promise<Array<{ args: Record<string, unknown> }>>;
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

export interface StartReviewInput {
  repo: string;
  prNumber: number;
  autoReview: boolean;
  forced?: boolean;
  actor?: string;
}

/** Start a code-review line and post the how-to comment; forced bypasses auto-review gate. */
export async function startReview(
  project: CodeReviewProject,
  input: StartReviewInput,
  uiUrl?: string,
): Promise<string | null> {
  const pr = await project.pulls.get(input.prNumber);

  if (!pr || !reviewGateOpen(pr, input)) {
    return null;
  }

  if (input.forced) {
    await retireOpenRechecks(project, input.prNumber);
  }
  const started = await startReviewLine(project, input, pr);

  // A JOINed run was announced when it started; announcing again posts a duplicate comment.
  if (!started.joined) {
    await announceReview(project, input.prNumber, started.id, uiUrl);
  }

  return started.id;
}

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

/** A person asking for a review by hand supersedes the fast pass a push started: left open it would post a second, shallower verdict on the same sha, and the engine would keep both lines walking. */
async function retireOpenRechecks(
  project: CodeReviewProject,
  prNumber: number,
): Promise<void> {
  const closed = await project.assemblyRuns.finishOpenByPr(
    prNumber,
    "superseded",
    ["code-review-recheck"],
  );

  for (const run of closed) {
    console.log(
      `[code-review] PR #${prNumber}: re-check ${run.id} superseded by a requested review`,
    );
  }
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

/** Fast re-check for pushes after initial review; BRANCH_SHARED_WORKSPACE prevents lease_held drops. Returns null when the push earns no pass of its own — see {@link decideRecheck}. */
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

  return startRecheckFor(project, input, pr);
}

async function startRecheckFor(
  project: CodeReviewProject,
  input: { repo: string; prNumber: number },
  pr: PullRef,
): Promise<string | null> {
  const range = await judgedRange(project, input.prNumber);
  const decision = decideRecheck({
    headSha: pr.headSha,
    openReviewShas: await openReviewShas(project, input.prNumber),
    newCommitMessages: range.newCommitMessages,
  });

  return decision.start
    ? project.assemblyRuns.start("code-review-recheck", {
        branch: pr.branch,
        args: recheckArgs(input.repo, input.prNumber, pr, range.sinceSha),
      })
    : skipped(input.prNumber, decision.reason);
}

/** Says why this push gets no pass of its own, where a silent null would read as a dropped event. */
function skipped(prNumber: number, reason: string): null {
  console.log(`[code-review] PR #${prNumber}: no re-check — ${reason}`);

  return null;
}

/** Where the last verdict left off: the sha it judged and the commits pushed since. The two are resolved together because they fail together — after a rebase the judged commit is no longer on the branch, and naming it would send the pod to `git diff <orphan>..HEAD`, against unrelated history or none at all. Then there is no range, and the whole PR is new again. */
async function judgedRange(
  project: CodeReviewProject,
  prNumber: number,
): Promise<{ sinceSha?: string; newCommitMessages: string[] }> {
  const runs = await project.assemblyRuns.listForPr(
    prNumber,
    REVIEW_DEFINITIONS,
  );
  const lastSha = shaOf(runs[0]?.args);
  const commits = lastSha ? await project.pulls.listCommits(prNumber) : [];
  const judged = commits.findIndex((commit) => commit.sha === lastSha);

  return judged < 0
    ? { newCommitMessages: [] }
    : {
        sinceSha: lastSha,
        newCommitMessages: commits.slice(judged + 1).map((c) => c.message),
      };
}

/** The head shas the review-family runs still in flight were started for. */
async function openReviewShas(
  project: CodeReviewProject,
  prNumber: number,
): Promise<string[]> {
  const open = await project.assemblyRuns.findOpenByPr(prNumber);

  return open
    .filter((run) => REVIEW_DEFINITIONS.includes(run.blueprintName as never))
    .map((run) => shaOf(run.args))
    .filter((sha): sha is string => sha !== undefined);
}

function shaOf(args: Record<string, unknown> | undefined): string | undefined {
  const sha = args?.head_sha;

  return typeof sha === "string" ? sha : undefined;
}

function recheckArgs(
  repo: string,
  prNumber: number,
  pr: PullRef,
  sinceSha?: string,
): Record<string, unknown> {
  return {
    pr_number: prNumber,
    mode: "recheck",
    head_sha: pr.headSha,
    actor: pr.author,
    description: recheckDescription(repo, prNumber, pr.branch, sinceSha),
  };
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
