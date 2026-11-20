// The post-review service station: posts the review agent's findings to the pull request and publishes its verdict as the lore/code-review check, on the external floor engine. A re-check handed Lore's open findings settles their threads when it approves, before the check says so, so no wait reads an approval beside threads it has settled.

import {
  defineStation,
  type Handle,
  type Brief,
  type Report,
  type RunningStation,
} from "@re-cinq/floor-station";
import { resultTextFromOutput } from "@re-cinq/lore-assembly-lines";
import type { CheckRunInput } from "@re-cinq/lore-shared/project/lib/github-port.js";
import type {
  BranchRule,
  PullRef,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { commentablePositions } from "@re-cinq/lore-shared/review/diff-hunks.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { projectFor } from "../../outbound/project-boot.js";
import { maybePostReview, type ReviewPoster } from "./post-review.js";
import { reviewModelOf } from "./review-model.js";
import { loreAppLogin } from "@re-cinq/lore-shared/project/github-installations/lore-app-login.js";
import { loreReviewerGitHub } from "@re-cinq/lore-shared/project/github-installations/lore-reviewer.js";
import { parsePullRequestUrl } from "@re-cinq/lore-shared/floor/floor-items.js";
import {
  findingCountOf,
  reviewCheck,
  reviewVerdictOf,
  type ReviewVerdict,
} from "./review-check.js";

export interface ReviewProject {
  pulls: ReviewPoster & {
    resolveReviewThread(threadId: string): Promise<void>;
    get(
      number: number,
    ): Promise<Pick<
      PullRef,
      "headSha" | "baseBranch" | "state" | "author"
    > | null>;
    getBranchRule(
      branch: string,
    ): Promise<Pick<BranchRule, "requiredApprovals">>;
  };
  upsertCheckRun(input: CheckRunInput): Promise<void>;
}

export interface PostReviewDeps {
  project(repo: string): Promise<ReviewProject>;
  reviewModel(visitId: string): Promise<string | undefined>;
  /** How lore-reviewer posts a review on a pull request `author` opened; nothing when Lore's own App may give the verdict there. */
  reviewerFor(
    repo: string,
    author: string | undefined,
  ): Promise<ReviewPoster["createReview"] | undefined>;
}

const productionDeps: PostReviewDeps = {
  project: async (repo) => {
    const project = await projectFor(repo);

    return {
      pulls: project.pulls,
      upsertCheckRun: (input) => project.repo.upsertCheckRun(input),
    };
  },
  reviewModel: reviewModelOf,
  reviewerFor: async (repo, author) => {
    const reviewer = loreReviewerGitHub();

    return reviewer && author !== undefined && author === (await loreAppLogin())
      ? (number, input) => reviewer.createReview(repo, number, input)
      : undefined;
  },
};

/** The PR state one visit acts on: the head commit the check names. */
interface ReviewTarget {
  prNumber: number;
  headSha: string;
}

export function postReviewHandle(deps: PostReviewDeps): Handle {
  return async (brief, tools) => {
    const prUrl = brief.needs.pr_url;
    const agentOutput = resultTextFromOutput(
      (await tools.read("review_output")).toString("utf8"),
    );
    const verdict = reviewVerdictOf(agentOutput);

    enforceTrue(verdict, Error, `no review verdict in the output for ${prUrl}`);
    const visit = await openVisit(deps, brief, parsePullRequestUrl(prUrl));

    if (!visit) {
      return { outcome: "superseded" };
    }

    await deliverReview(deps, brief, visit, { agentOutput, verdict });

    return settleReview(visit, brief, { agentOutput, verdict });
  };
}

async function settleReview(
  visit: ReviewVisitState,
  brief: Brief,
  { agentOutput, verdict }: { agentOutput: string; verdict: ReviewVerdict },
): Promise<Report> {
  if (verdict === "success") {
    await resolveHandedThreads(visit, brief);
  }
  const summary = verdictSummary(verdict, findingCountOf(agentOutput));

  await visit.project.upsertCheckRun(
    reviewCheck({ headSha: visit.target.headSha, verdict, summary }),
  );

  return reported(summary, brief.needs.pr_url);
}

interface ReviewVisitState {
  project: ReviewProject;
  /** Who posts the review: lore-reviewer on a pull request Lore's own App opened, where GitHub takes a verdict and inline comments from no one else of Lore's. */
  poster: ReviewPoster;
  /** The base branch's rule requires an approval: there the review does not approve, since the auto-merge loop gives the approval that counts (specs/protected-branch-merge). */
  approvalCounts: boolean;
  target: ReviewTarget;
}

async function openVisit(
  deps: PostReviewDeps,
  brief: Brief,
  { repo, prNumber }: { repo: string; prNumber: number },
): Promise<ReviewVisitState | undefined> {
  const project = await deps.project(repo);
  const pull = await project.pulls.get(prNumber);
  const headSha = briefedShaOf(brief) ?? pull?.headSha;

  enforceTrue(headSha, Error, `no head sha for pull request #${prNumber}`);

  if (pull?.state !== "open" || pull.headSha !== headSha) {
    return undefined;
  }

  return {
    project,
    poster: posterFor(project.pulls, await deps.reviewerFor(repo, pull.author)),
    approvalCounts: await approvalCountsOn(project, pull),
    target: { prNumber, headSha },
  };
}

async function deliverReview(
  deps: PostReviewDeps,
  brief: Brief,
  visit: ReviewVisitState,
  { agentOutput }: { agentOutput: string; verdict: ReviewVerdict },
): Promise<void> {
  await postToPullRequest(brief, visit.poster, visit.target.prNumber, {
    agentOutput,
    model: await deps.reviewModel(brief.visitId),
    allowApprove: !visit.approvalCounts,
    commitId: visit.target.headSha,
  });
}

/** Whether the base branch's rule requires an approval; a PR with no base branch read counts as unprotected. */
async function approvalCountsOn(
  project: ReviewProject,
  pull: Pick<PullRef, "baseBranch"> | null,
): Promise<boolean> {
  if (!pull?.baseBranch) {
    return false;
  }
  const rule = await project.pulls.getBranchRule(pull.baseBranch);

  return rule.requiredApprovals > 0;
}

/** The threads of Lore's findings the re-check was handed and judged resolved. Best-effort: the verdict is posted either way, and a thread left open only holds the merge for a person. */
async function resolveHandedThreads(
  { project: { pulls }, target }: ReviewVisitState,
  brief: Brief,
): Promise<void> {
  const ids = new Map(Object.entries(brief.needs)).get("open_threads");

  if (!ids || (await pulls.get(target.prNumber))?.headSha !== target.headSha) {
    return;
  }
  const outcomes = await Promise.allSettled(
    ids
      .split(",")
      .filter(Boolean)
      .map((threadId) => pulls.resolveReviewThread(threadId)),
  );

  outcomes
    .filter((outcome) => outcome.status === "rejected")
    .forEach(({ reason }) =>
      console.warn(`[post-review] thread not resolved: ${String(reason)}`),
    );
}

function briefedShaOf(brief: Brief): string | undefined {
  return new Map(Object.entries(brief.needs)).get("head_sha");
}

function reported(summary: string, prUrl: string): Report {
  return {
    outcome: "success",
    produced: { review_summary: summary, review_url: prUrl },
  };
}

function verdictSummary(verdict: ReviewVerdict, findingCount: number): string {
  const label = verdict === "success" ? "Approved" : "Changes requested";

  return `${label}, ${findingCount} ${findingCount === 1 ? "finding" : "findings"}`;
}

interface PostOptions {
  agentOutput: string;
  model?: string;
  allowApprove: boolean;
  commitId: string;
}

function posterFor(
  pulls: ReviewPoster,
  createReview: ReviewPoster["createReview"] | undefined,
): ReviewPoster {
  if (!createReview) {
    return pulls;
  }

  return {
    createReview,
    comment: (number, body) => pulls.comment(number, body),
    getDiff: (number) => pulls.getDiff(number),
    listReviews: pulls.listReviews?.bind(pulls),
    listIssueComments: pulls.listIssueComments?.bind(pulls),
  };
}

async function postToPullRequest(
  brief: Brief,
  pulls: ReviewPoster,
  prNumber: number,
  opts: PostOptions,
): Promise<void> {
  const diff = await pulls.getDiff(prNumber).catch(() => "");
  const posted = await maybePostReview(pulls, prNumber, opts.agentOutput, {
    positions: commentablePositions(diff),
    visit: { ...brief, reviewRun: brief.needs.review_run },
    ...opts,
  });

  enforceTrue(
    posted,
    Error,
    `nothing to post for #${prNumber}: no findings block`,
  );
}

export function startPostReviewStation(): RunningStation {
  return defineStation("post-review", postReviewHandle(productionDeps));
}
