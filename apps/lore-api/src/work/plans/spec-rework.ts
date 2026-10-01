// Rework the specs from the spec PR's review (specs/7-feature-planning): while the planning line waits on the PR, a person asks for the writer to run again in the SAME line. lore-api gathers what the review left open, stores it on the run's args, and asks for the `write` station through the hand-run mechanism; the Floor launches it on the event.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { PlanLine } from "@re-cinq/lore-shared/project/plans/plan-run.js";
import type { PullRequests } from "@re-cinq/lore-shared/project/pulls/pull-requests.js";
import {
  SPEC_REVIEW_ARG,
  SPEC_REVIEW_REOPEN_ARG,
  specReviewIsEmpty,
  specReviewOf,
  type SpecReview,
} from "@re-cinq/lore-shared/review/spec-review.js";
import {
  runStation,
  type RunStationDeps,
} from "../assembly-runs/run-station.js";
import { NOT_APPROVED } from "./planning-line.js";

/** The repo-bound reads the review is gathered from. */
export type SpecReviewReads = Pick<
  PullRequests,
  "listReviewThreads" | "listComments" | "listReviews"
>;

export interface SpecReworkDeps {
  runs: Pick<AssemblyRunsPort, "mergeArgs">;
  pulls: SpecReviewReads;
  station: RunStationDeps;
}

export interface SpecReworkInput {
  plan: { id: string; status: string };
  /** The plan's line, as `planLineState` read it. */
  line: PlanLine;
  actor: string;
}

/** The writer's node in the planning line. */
const WRITE_NODE = "write";

export const SPEC_PR_NOT_WAITING = "the spec PR is not waiting for review";

const NOTHING_OPEN =
  "nothing on the spec PR is waiting for the writer: no unresolved comment and no review body";

/** The run's id once the writer is asked for. 409 for a plan not approved, a line not parked on the spec PR, a line with no spec PR, or a review with nothing left open. */
export async function startSpecRework(
  deps: SpecReworkDeps,
  { plan, line, actor }: SpecReworkInput,
): Promise<string> {
  const prNumber = assertReworkable(plan, line);
  const review = await gatherOpenReview(deps.pulls, prNumber);

  await deps.runs.mergeArgs(line.lineId, {
    [SPEC_REVIEW_ARG]: JSON.stringify(review),
    [SPEC_REVIEW_REOPEN_ARG]: null,
  });

  return runStation(deps.station, {
    runId: line.lineId,
    nodeId: WRITE_NODE,
    actor,
  });
}

/** The refusals a rework asks before it starts, whichever engine read the line; the spec PR's number once it passes. */
export function assertReworkable(
  plan: SpecReworkInput["plan"],
  line: PlanLine,
): number {
  enforceTrue(plan.status === "approved", apiError(409), NOT_APPROVED);
  enforceTrue(
    line.open !== null && line.parkedMerged !== null,
    apiError(409),
    SPEC_PR_NOT_WAITING,
  );
  enforceTrue(line.prNumber !== null, apiError(409), "the line has no spec PR");

  return line.prNumber;
}

/** What the spec PR's review left open; refused when there is nothing for the writer to do. */
export async function gatherOpenReview(
  pulls: SpecReviewReads,
  prNumber: number,
): Promise<SpecReview> {
  const review = await gatherReview(pulls, prNumber);

  enforceTrue(!specReviewIsEmpty(review), apiError(409), NOTHING_OPEN);

  return review;
}

async function gatherReview(
  pulls: SpecReviewReads,
  prNumber: number,
): Promise<SpecReview> {
  const [threads, comments, reviews] = await Promise.all([
    pulls.listReviewThreads(prNumber),
    pulls.listComments(prNumber),
    pulls.listReviews(prNumber),
  ]);

  return specReviewOf(prNumber, { threads, comments, reviews });
}
