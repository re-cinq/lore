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
  writeAuditRow?(row: any): Promise<void>;
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
  return async (brief, tools) => {
    const prUrl = brief.needs.pr_url;
    const location = parsePullRequestUrl(prUrl);
    const agentOutput = resultTextFromOutput(
      (await tools.read("review_output")).toString("utf8"),
    );
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

    await postToPullRequest(brief, project, location, {
      agentOutput,
      model: await deps.reviewModel(brief.visitId),
    });
    await project.upsertCheckRun(reviewCheck({ headSha, verdict, summary }));

    if (pull?.branch && project.getBranchRule) {
      const rule = await project.getBranchRule(pull.branch);
      if (rule.requiresApprovals > 0) {
        if (project.pulls.enableAutoMerge) {
          await project.pulls.enableAutoMerge(location.prNumber, "SQUASH");
        }
        if (project.writeAuditRow) {
          await project.writeAuditRow({
            event_type: "auto_merge_armed",
            payload: { prNumber: location.prNumber, headSha },
          });
        }
      }
    }

    return reported(summary, prUrl);
  };
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
  { agentOutput, model }: { agentOutput: string; model?: string },
): Promise<void> {
  const diff = await diffOf(project.pulls, prNumber);
  const posted = await maybePostReview(project.pulls, prNumber, agentOutput, {
    positions: commentablePositions(diff),
    visit: brief,
    model,
  });

  enforceTrue(
    posted,
    Error,
    `nothing to post for #${prNumber}: no findings block`,
  );
}

function diffOf(pulls: ReviewPoster, prNumber: number): Promise<string> {
  return pulls.getDiff(prNumber).catch(() => "");
}

export function startPostReviewStation(): RunningStation {
  return defineStation("post-review", postReviewHandle(productionDeps));
}
