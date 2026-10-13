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
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { commentablePositions } from "@re-cinq/lore-shared/review/diff-hunks.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { projectFor } from "../../outbound/project-boot.js";
import { maybePostReview, type ReviewPoster } from "./post-review.js";
import { reviewModelOf } from "./review-model.js";
import {
  parsePullRequestUrl,
  type PullRequestLocation,
} from "@re-cinq/lore-shared/floor/floor-items.js";
import {
  findingCountOf,
  reviewCheck,
  reviewVerdictOf,
  type ReviewVerdict,
} from "./review-check.js";

export interface ReviewProject {
  pulls: ReviewPoster & {
    get(number: number): Promise<Pick<PullRef, "headSha" | "branch"> | null>;
    enableAutoMerge?(number: number, method: string): Promise<void>;
  };
  upsertCheckRun(input: CheckRunInput): Promise<void>;
  getBranchRule?(branch: string): Promise<{ requiresApprovals: number }>;
  getSettings?(): Promise<{
    auto_merge?: { approver: "none" | "lore-reviewer" };
  }>;
  writeAuditRow?(row: { event_type: string; payload: unknown }): Promise<void>;
}

export interface PostReviewDeps {
  project(repo: string): Promise<ReviewProject>;
  reviewModel(visitId: string): Promise<string | undefined>;
}

const productionDeps: PostReviewDeps = {
  project: async (repo) => {
    const { pulls, repo: repository } = await projectFor(repo);

    return {
      pulls: pulls as unknown as ReviewProject["pulls"],
      upsertCheckRun: (input) => repository.upsertCheckRun(input),
    };
  },
  reviewModel: reviewModelOf,
};

export function postReviewHandle(deps: PostReviewDeps): Handle {
  return (brief, tools) => processPostReview(deps, brief, tools);
}

async function processPostReview(
  deps: PostReviewDeps,
  brief: Brief,
  tools: Parameters<Handle>[1],
): Promise<Report> {
  const prUrl = brief.needs.pr_url;
  const location = parsePullRequestUrl(prUrl);
  const rawOutput = (await tools.read("review_output")).toString("utf8");
  const agentOutput = resultTextFromOutput(rawOutput);

  const verdict = reviewVerdictOf(agentOutput);
  enforceTrue(verdict, Error, `no review verdict in the output for ${prUrl}`);

  const project = await deps.project(location.repo);
  const pull = await project.pulls.get(location.prNumber);

  const headSha = briefedShaOf(brief) ?? pull?.headSha;
  enforceTrue(
    headSha,
    Error,
    `no head sha for pull request #${location.prNumber}`,
  );

  const summary = verdictSummary(verdict, findingCountOf(agentOutput));
  const approver = await getApprover(project);

  const posted = await postToPullRequest(brief, project, location, {
    agentOutput,
    model: await deps.reviewModel(brief.visitId),
    allowApprove: approver === "lore-reviewer",
  });

  if (posted) {
    await performPostReviewActions(
      project,
      location,
      headSha,
      verdict,
      approver,
      pull,
    );
  }

  await project.upsertCheckRun(reviewCheck({ headSha, verdict, summary }));
  return reported(summary, prUrl);
}

async function getApprover(
  project: ReviewProject,
): Promise<"none" | "lore-reviewer"> {
  if (!project.getSettings) return "none";
  const settings = await project.getSettings();
  return settings.auto_merge?.approver ?? "none";
}

async function performPostReviewActions(
  project: ReviewProject,
  location: PullRequestLocation,
  headSha: string,
  verdict: ReviewVerdict,
  approver: string,
  pull: Pick<PullRef, "headSha" | "branch"> | null,
): Promise<void> {
  await recordApprovalIfNeeded(project, location, headSha, verdict, approver);
  await armAutoMergeIfNeeded(project, pull, location, headSha);
}

async function recordApprovalIfNeeded(
  project: ReviewProject,
  location: PullRequestLocation,
  headSha: string,
  verdict: ReviewVerdict,
  approver: string,
): Promise<void> {
  if (
    verdict === "success" &&
    approver === "lore-reviewer" &&
    project.writeAuditRow
  ) {
    await project.writeAuditRow({
      event_type: "lore_reviewer_approved",
      payload: {
        prNumber: location.prNumber,
        headSha,
        approver: "lore-reviewer",
      },
    });
  }
}

async function armAutoMergeIfNeeded(
  project: ReviewProject,
  pull: Pick<PullRef, "headSha" | "branch"> | null,
  location: PullRequestLocation,
  headSha: string,
): Promise<void> {
  if (!pull?.branch || !project.getBranchRule) return;

  const rule = await project.getBranchRule(pull.branch);
  if (rule.requiresApprovals === 0) return;

  await enableAutoMerge(project, location.prNumber);
  await recordAutoMergeArmed(project, location.prNumber, headSha);
}

async function enableAutoMerge(
  project: ReviewProject,
  prNumber: number,
): Promise<void> {
  if (project.pulls.enableAutoMerge) {
    await project.pulls.enableAutoMerge(prNumber, "SQUASH");
  }
}

async function recordAutoMergeArmed(
  project: ReviewProject,
  prNumber: number,
  headSha: string,
): Promise<void> {
  if (project.writeAuditRow) {
    await project.writeAuditRow({
      event_type: "auto_merge_armed",
      payload: { prNumber, headSha },
    });
  }
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
  project: ReviewProject,
  { prNumber }: PullRequestLocation,
  opts: { agentOutput: string; model?: string; allowApprove?: boolean },
): Promise<boolean> {
  const diff = await diffOf(project.pulls, prNumber);
  const posted = await maybePostReview(
    project.pulls,
    prNumber,
    opts.agentOutput,
    {
      positions: commentablePositions(diff),
      visit: brief,
      model: opts.model,
      allowApprove: opts.allowApprove,
    },
  );

  enforceTrue(
    posted,
    Error,
    `nothing to post for #${prNumber}: no findings block`,
  );
  return posted.mode !== "deduped";
}

function diffOf(pulls: ReviewPoster, prNumber: number): Promise<string> {
  return pulls.getDiff(prNumber).catch(() => "");
}

export function startPostReviewStation(): RunningStation {
  return defineStation("post-review", postReviewHandle(productionDeps));
}
