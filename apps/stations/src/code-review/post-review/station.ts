// The post-review service station: posts the review agent's findings to the pull request and publishes its verdict as the lore/code-review check, on the external floor engine.

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
import { parsePullRequestUrl } from "@re-cinq/lore-shared/floor/floor-items.js";
import {
  findingCountOf,
  reviewCheck,
  reviewVerdictOf,
  type ReviewVerdict,
} from "./review-check.js";

export interface ReviewProject {
  pulls: ReviewPoster & {
    get(
      number: number,
    ): Promise<Pick<PullRef, "headSha" | "baseBranch"> | null>;
    getBranchRule(
      branch: string,
    ): Promise<Pick<BranchRule, "requiredApprovals">>;
  };
  upsertCheckRun(input: CheckRunInput): Promise<void>;
}

export interface PostReviewDeps {
  project(repo: string): Promise<ReviewProject>;
  reviewModel(visitId: string): Promise<string | undefined>;
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

    await deliverReview(deps, brief, visit, { agentOutput, verdict });
    const summary = verdictSummary(verdict, findingCountOf(agentOutput));

    await visit.project.upsertCheckRun(
      reviewCheck({ headSha: visit.target.headSha, verdict, summary }),
    );

    return reported(summary, prUrl);
  };
}

interface ReviewVisitState {
  project: ReviewProject;
  /** The base branch's rule requires an approval: there the review does not approve, since the auto-merge loop gives the approval that counts (specs/protected-branch-merge). */
  approvalCounts: boolean;
  target: ReviewTarget;
}

async function openVisit(
  deps: PostReviewDeps,
  brief: Brief,
  { repo, prNumber }: { repo: string; prNumber: number },
): Promise<ReviewVisitState> {
  const project = await deps.project(repo);
  const pull = await project.pulls.get(prNumber);
  const headSha = briefedShaOf(brief) ?? pull?.headSha;

  enforceTrue(headSha, Error, `no head sha for pull request #${prNumber}`);

  return {
    project,
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
  await postToPullRequest(brief, visit.project.pulls, visit.target.prNumber, {
    agentOutput,
    model: await deps.reviewModel(brief.visitId),
    allowApprove: !visit.approvalCounts,
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

async function postToPullRequest(
  brief: Brief,
  pulls: ReviewProject["pulls"],
  prNumber: number,
  opts: { agentOutput: string; model?: string; allowApprove: boolean },
): Promise<void> {
  const diff = await pulls.getDiff(prNumber).catch(() => "");
  const posted = await maybePostReview(pulls, prNumber, opts.agentOutput, {
    positions: commentablePositions(diff),
    visit: brief,
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
