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
    ): Promise<Pick<PullRef, "headSha" | "branch" | "nodeId"> | null>;
    enableAutoMerge?(nodeId: string, method: string): Promise<void>;
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

interface ReviewContext {
  project: ReviewProject;
  prUrl: string;
  prNumber: number;
  nodeId?: string;
  agentOutput: string;
  verdict: ReviewVerdict;
  headSha: string;
  branch?: string;
}

async function processPostReview(
  deps: PostReviewDeps,
  brief: Brief,
  tools: Parameters<Handle>[1],
) {
  const output = await getReviewOutput(brief, tools);
  const ctx = await getReviewPullContext(deps, brief);

  return finishReview(deps, brief, {
    project: ctx.project,
    prUrl: ctx.prUrl,
    prNumber: ctx.loc.prNumber,
    nodeId: ctx.pull?.nodeId,
    agentOutput: output.agentOutput,
    verdict: output.verdict,
    headSha: ctx.headSha,
    branch: ctx.pull?.branch,
  });
}

async function getReviewOutput(brief: Brief, tools: Parameters<Handle>[1]) {
  const outRaw = (await tools.read("review_output")).toString("utf8");
  const agentOutput = resultTextFromOutput(outRaw);
  const verdict = reviewVerdictOf(agentOutput);
  enforceTrue(verdict, Error, `no review verdict for ${brief.needs.pr_url}`);
  return { agentOutput, verdict };
}

async function getReviewPullContext(deps: PostReviewDeps, brief: Brief) {
  const prUrl = brief.needs.pr_url;
  const loc = parsePullRequestUrl(prUrl);
  const project = await deps.project(loc.repo);
  const pull = await project.pulls.get(loc.prNumber);
  const headSha = briefedShaOf(brief) ?? pull?.headSha;
  enforceTrue(headSha, Error, `no head sha for #${loc.prNumber}`);
  return { project, pull, prUrl, loc, headSha };
}

async function finishReview(
  deps: PostReviewDeps,
  brief: Brief,
  opts: ReviewContext,
) {
  const count = findingCountOf(opts.agentOutput);
  const summary = verdictSummary(opts.verdict, count);
  const approver = await getApprover(opts.project);
  const posted = await postReviewToPr(deps, brief, opts, approver);

  if (posted) {
    await performPostReviewActions(opts.project, { ...opts, approver });
  }

  await opts.project.upsertCheckRun(
    reviewCheck({ headSha: opts.headSha, verdict: opts.verdict, summary }),
  );

  return reported(summary, opts.prUrl);
}

async function postReviewToPr(
  deps: PostReviewDeps,
  brief: Brief,
  opts: ReviewContext,
  approver: string,
) {
  return postToPullRequest(brief, opts.project.pulls, opts.prNumber, {
    agentOutput: opts.agentOutput,
    model: await deps.reviewModel(brief.visitId),
    allowApprove: approver === "lore-reviewer",
  });
}

async function getApprover(
  project: ReviewProject,
): Promise<"none" | "lore-reviewer"> {
  if (!project.getSettings) {
    return "none";
  }
  const settings = await project.getSettings();

  return settings.auto_merge?.approver ?? "none";
}

async function performPostReviewActions(
  project: ReviewProject,
  opts: {
    prNumber: number;
    nodeId?: string;
    headSha: string;
    verdict: ReviewVerdict;
    approver: string;
    branch?: string;
  },
): Promise<void> {
  await recordApprovalIfNeeded(project, opts);
  await armAutoMergeIfNeeded(project, opts);
}

interface RecordApprovalOpts {
  prNumber: number;
  headSha: string;
  verdict: ReviewVerdict;
  approver: string;
}

async function recordApprovalIfNeeded(
  project: ReviewProject,
  opts: RecordApprovalOpts,
): Promise<void> {
  const shouldApprove =
    opts.verdict === "success" && opts.approver === "lore-reviewer";

  if (shouldApprove && project.writeAuditRow) {
    await project.writeAuditRow({
      event_type: "lore_reviewer_approved",
      payload: {
        prNumber: opts.prNumber,
        headSha: opts.headSha,
        approver: "lore-reviewer",
      },
    });
  }
}

async function armAutoMergeIfNeeded(
  project: ReviewProject,
  opts: { prNumber: number; nodeId?: string; headSha: string; branch?: string },
): Promise<void> {
  if (!opts.branch || !project.getBranchRule) {
    return;
  }

  const rule = await project.getBranchRule(opts.branch);

  if (rule.requiresApprovals === 0) {
    return;
  }

  if (opts.nodeId) {
    await enableAutoMerge(project, opts.nodeId);
  }
  await recordAutoMergeArmed(project, opts.prNumber, opts.headSha);
}

async function enableAutoMerge(
  project: ReviewProject,
  nodeId: string,
): Promise<void> {
  if (project.pulls.enableAutoMerge) {
    await project.pulls.enableAutoMerge(nodeId, "SQUASH");
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
  pulls: ReviewProject["pulls"],
  prNumber: number,
  opts: { agentOutput: string; model?: string; allowApprove?: boolean },
): Promise<boolean> {
  const diff = await pulls.getDiff(prNumber).catch(() => "");
  const posted = await maybePostReview(pulls, prNumber, opts.agentOutput, {
    positions: commentablePositions(diff),
    visit: brief,
    ...opts,
  });

  enforceTrue(posted, Error, `nothing to post for #${prNumber}`);

  return posted.mode !== "deduped";
}

export function startPostReviewStation(): RunningStation {
  return defineStation("post-review", postReviewHandle(productionDeps));
}
