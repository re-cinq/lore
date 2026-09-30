// The post-review service station: posts the review agent's findings to the pull request and publishes its verdict as the lore/code-review check, on the external floor engine.

import {
  defineStation,
  type Handle,
  type Brief,
  type RunningStation,
} from "@re-cinq/floor-station";
import { resultTextFromOutput } from "@re-cinq/lore-assembly-lines";
import type { CheckRunInput } from "@re-cinq/lore-shared/project/lib/github-port.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { commentablePositions } from "@re-cinq/lore-shared/review/diff-hunks.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { projectFor } from "../../outbound/project-boot.js";
import { maybePostReview, type ReviewPoster } from "./post-review.js";
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
    get(number: number): Promise<Pick<PullRef, "headSha"> | null>;
  };
  upsertCheckRun(input: CheckRunInput): Promise<void>;
}

export interface PostReviewDeps {
  project(repo: string): Promise<ReviewProject>;
}

const productionDeps: PostReviewDeps = {
  project: async (repo) => {
    const { pulls, repo: repository } = await projectFor(repo);

    return {
      pulls,
      upsertCheckRun: (input) => repository.upsertCheckRun(input),
    };
  },
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
    const headSha = await headShaOf(brief, project, location.prNumber);
    const summary = verdictSummary(verdict, findingCountOf(agentOutput));

    await postToPullRequest(brief, project, location, agentOutput);
    await project.upsertCheckRun(reviewCheck({ headSha, verdict, summary }));

    return {
      outcome: "success",
      produced: { review_summary: summary, review_url: prUrl },
    };
  };
}

function verdictSummary(verdict: ReviewVerdict, findingCount: number): string {
  const label = verdict === "success" ? "Approved" : "Changes requested";

  return `${label}, ${findingCount} ${findingCount === 1 ? "finding" : "findings"}`;
}

async function headShaOf(
  brief: Brief,
  { pulls }: ReviewProject,
  prNumber: number,
): Promise<string> {
  const briefed = new Map(Object.entries(brief.needs)).get("head_sha");
  const headSha = briefed ?? (await pulls.get(prNumber))?.headSha;

  enforceTrue(headSha, Error, `no head sha for pull request #${prNumber}`);

  return headSha;
}

async function postToPullRequest(
  brief: Brief,
  project: ReviewProject,
  { prNumber }: PullRequestLocation,
  agentOutput: string,
): Promise<void> {
  const diff = await diffOf(project.pulls, prNumber);
  const posted = await maybePostReview(project.pulls, prNumber, agentOutput, {
    positions: commentablePositions(diff),
    visit: brief,
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
