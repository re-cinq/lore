// The run-settled service station: started by the floor's own `internal.run.settled` event, it is how Lore hears that a run ended.
import {
  defineStation,
  type Handle,
  type Report,
  type RunningStation,
} from "@re-cinq/floor-station";
import type { RunView } from "@re-cinq/floor-client";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import { parsePullRequestUrl } from "@re-cinq/lore-shared/floor/floor-items.js";
import type { CheckRunInput } from "@re-cinq/lore-shared/project/lib/github-port.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { projectFor } from "../../outbound/project-boot.js";
import { budgetSkipBody } from "@re-cinq/lore-shared/review/review-summary.js";
import type { ReviewPoster } from "../post-review/post-review.js";
import {
  reviewAlreadyPosted,
  reviewVisitMarker,
  signed,
} from "../post-review/post-review.js";
import {
  brokenReviewCheck,
  budgetSkipCheck,
  failedAgentVisitOf,
  isOutOfBudget,
  reviewBroke,
  startValueOf,
  type FailedAgentVisit,
} from "./run-settled.js";

export interface SettledProject extends Pick<
  ReviewPoster,
  "createReview" | "listReviews" | "listIssueComments"
> {
  pullHead(prNumber: number): Promise<Pick<PullRef, "headSha"> | null>;
  upsertCheckRun(input: CheckRunInput): Promise<void>;
}

export interface RunSettledDeps {
  run(runId: string): Promise<RunView | null>;
  failedAgentVisit(runId: string): Promise<FailedAgentVisit | null>;
  project(repo: string): Promise<SettledProject>;
}

const SETTLED: Report = { outcome: "success" };

export function runSettledHandle(deps: RunSettledDeps): Handle {
  return async ({ needs }) => {
    if (!reviewBroke(needs.line_id, needs.outcome)) {
      return SETTLED;
    }
    const run = await deps.run(needs.run_id);
    const prUrl = run && startValueOf(run, "pr_url");

    if (prUrl) {
      await publishBrokenReview(deps, run, prUrl);
    }

    return SETTLED;
  };
}

async function publishBrokenReview(
  deps: RunSettledDeps,
  run: RunView,
  prUrl: string,
): Promise<void> {
  const { repo, prNumber } = parsePullRequestUrl(prUrl);
  const project = await deps.project(repo);
  const headSha =
    startValueOf(run, "head_sha") ??
    (await project.pullHead(prNumber))?.headSha;

  if (headSha) {
    await settleBrokenReview(deps, project, { run, headSha, prNumber });
  }
}

async function settleBrokenReview(
  deps: RunSettledDeps,
  project: SettledProject,
  {
    run,
    headSha,
    prNumber,
  }: { run: RunView; headSha: string; prNumber: number },
): Promise<void> {
  const failure = await deps.failedAgentVisit(run.id);

  if (!isOutOfBudget(failure)) {
    await project.upsertCheckRun(brokenReviewCheck(headSha, run));

    return;
  }
  await approveWithoutReview(project, prNumber, failure);
  await project.upsertCheckRun(budgetSkipCheck(headSha, run));
}

/** A review that could not run for want of budget approves loudly, so the pull request is not blocked on an operator problem; the visit's marker keeps a redelivery from approving twice. GitHub refuses an approval from the account that opened the pull request, so the notice then lands as a COMMENT review. */
async function approveWithoutReview(
  project: SettledProject,
  prNumber: number,
  failure: FailedAgentVisit,
): Promise<void> {
  const visit = { visitId: failure.visitId, iteration: failure.iteration };

  if (await reviewAlreadyPosted(project, prNumber, reviewVisitMarker(visit))) {
    return;
  }
  const body = signed(budgetSkipBody(failure.model), visit);
  const post = (event: "APPROVE" | "COMMENT") =>
    project.createReview(prNumber, { event, body, comments: [] });

  await post("APPROVE").catch(() => post("COMMENT"));
}

const productionDeps: RunSettledDeps = {
  run: async (runId) => (await floorClient().runs.get(runId))?.run ?? null,
  failedAgentVisit: async (runId) =>
    failedAgentVisitOf(await floorClient().stationRuns.list({ run: runId })),
  project: async (repo) => {
    const { pulls, repo: repository } = await projectFor(repo);

    return {
      createReview: (prNumber, input) => pulls.createReview(prNumber, input),
      listReviews: (prNumber) => pulls.listReviews(prNumber),
      listIssueComments: (prNumber) => pulls.listIssueComments(prNumber),
      pullHead: (prNumber) => pulls.get(prNumber),
      upsertCheckRun: (input) => repository.upsertCheckRun(input),
    };
  },
};

export function startRunSettledStation(): RunningStation {
  return defineStation("run-settled", runSettledHandle(productionDeps));
}
