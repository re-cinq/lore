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
  MergeMethod,
  PullRef,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import type { AuditLogEntry } from "@re-cinq/lore-shared/project/audit/audit-port.js";
import { RepoSettingsSchema } from "@re-cinq/lore-shared/models/repo-settings.js";
import { commentablePositions } from "@re-cinq/lore-shared/review/diff-hunks.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { projectFor } from "../../outbound/project-boot.js";
import {
  maybePostReview,
  reviewAlreadyPosted,
  reviewVisitMarker,
  type ReviewPoster,
} from "./post-review.js";
import { reviewModelOf } from "./review-model.js";
import { parsePullRequestUrl } from "@re-cinq/lore-shared/floor/floor-items.js";
import {
  findingCountOf,
  reviewCheck,
  reviewVerdictOf,
  type ReviewVerdict,
} from "./review-check.js";

export type AutoMergeApprover = "none" | "lore-reviewer";

export interface ReviewProject {
  pulls: ReviewPoster & {
    get(
      number: number,
    ): Promise<Pick<PullRef, "headSha" | "baseBranch" | "nodeId"> | null>;
    enableAutoMerge(nodeId: string, method: MergeMethod): Promise<void>;
    getBranchRule(
      branch: string,
    ): Promise<Pick<BranchRule, "requiredApprovals">>;
  };
  upsertCheckRun(input: CheckRunInput): Promise<void>;
  autoMergeApprover(): Promise<AutoMergeApprover>;
  audit: { write(entry: Omit<AuditLogEntry, "repo">): Promise<void> };
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
      autoMergeApprover: async () =>
        approverOf(await project.settings.rawSettings()),
      audit: project.audit,
    };
  },
  reviewModel: reviewModelOf,
};

/** `auto_merge.approver` from the repo's stored settings; anything unset or unreadable is `none`, the default. */
export function approverOf(
  settings: Record<string, unknown> | null,
): AutoMergeApprover {
  const autoMerge = RepoSettingsSchema.shape.auto_merge;
  const parsed = autoMerge.safeParse(settings?.auto_merge);

  return (parsed.success && parsed.data?.approver) || "none";
}

/** The PR state one visit acts on: who approves, and the head commit the audit rows and the check name. */
interface ReviewTarget {
  prNumber: number;
  headSha: string;
  approver: AutoMergeApprover;
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
  /** The PR's GraphQL id when its base branch's rule requires an approval: only such a PR is armed, and only there does an approval need lore-reviewer. */
  armableNodeId: string | undefined;
  target: ReviewTarget;
  /** False on a redelivered visit whose review is already on the PR: nothing is armed, approved or audited twice. */
  firstVisit: boolean;
}

async function openVisit(
  deps: PostReviewDeps,
  brief: Brief,
  { repo, prNumber }: { repo: string; prNumber: number },
): Promise<ReviewVisitState> {
  const project = await deps.project(repo);
  const [pull, approver, posted] = await Promise.all([
    project.pulls.get(prNumber),
    project.autoMergeApprover(),
    reviewAlreadyPosted(project.pulls, prNumber, reviewVisitMarker(brief)),
  ]);
  const headSha = briefedShaOf(brief) ?? pull?.headSha;

  enforceTrue(headSha, Error, `no head sha for pull request #${prNumber}`);

  return {
    project,
    armableNodeId: await armableNodeIdOf(project, pull),
    target: { prNumber, headSha, approver },
    firstVisit: !posted,
  };
}

// GitHub refuses to arm a PR that can already merge, so arming precedes the APPROVE that would make it mergeable.
async function deliverReview(
  deps: PostReviewDeps,
  brief: Brief,
  visit: ReviewVisitState,
  { agentOutput, verdict }: { agentOutput: string; verdict: ReviewVerdict },
): Promise<void> {
  const { project, armableNodeId, target } = visit;
  const recordsApproval = visit.firstVisit && verdict === "success";

  if (recordsApproval && armableNodeId) {
    await armAutoMerge(project, armableNodeId, target);
  }
  await postToPullRequest(brief, project.pulls, target.prNumber, {
    agentOutput,
    model: await deps.reviewModel(brief.visitId),
    allowApprove: target.approver === "lore-reviewer" || !armableNodeId,
  });

  if (recordsApproval) {
    await recordLoreReviewerApproval(project, target);
  }
}

async function armAutoMerge(
  project: ReviewProject,
  nodeId: string,
  target: ReviewTarget,
): Promise<void> {
  await project.pulls.enableAutoMerge(nodeId, "squash");
  await project.audit.write(auditRow("auto_merge_armed", target));
}

async function recordLoreReviewerApproval(
  project: ReviewProject,
  target: ReviewTarget,
): Promise<void> {
  if (target.approver === "lore-reviewer") {
    await project.audit.write(auditRow("lore_reviewer_approved", target));
  }
}

/** Undefined on an unprotected base branch: the PR is already mergeable there, GitHub refuses to arm it, and an APPROVE merges nothing on its own. */
async function armableNodeIdOf(
  project: ReviewProject,
  pull: Pick<PullRef, "baseBranch" | "nodeId"> | null,
): Promise<string | undefined> {
  if (!pull?.baseBranch || !pull.nodeId) {
    return undefined;
  }
  const rule = await project.pulls.getBranchRule(pull.baseBranch);

  return rule.requiredApprovals > 0 ? pull.nodeId : undefined;
}

function auditRow(
  eventType: "auto_merge_armed" | "lore_reviewer_approved",
  { prNumber, headSha, approver }: ReviewTarget,
): Omit<AuditLogEntry, "repo"> {
  return { event_type: eventType, payload: { prNumber, headSha, approver } };
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
