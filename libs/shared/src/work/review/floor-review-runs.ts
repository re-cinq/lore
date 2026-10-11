// What the floor holds about one pull request's reviews: the read side of the review lines, for everything in Lore that asks whether a review ran or is still running.
import type { FloorClient, Item, RunView } from "@re-cinq/floor-client";
import {
  floorRepoOf,
  pullRequestUrl,
} from "../../outbound/floor/floor-items.js";

export const REVIEW_LINE = "code-review";
export const RECHECK_LINE = "code-review-recheck";
export const REPLY_LINE = "code-review-reply";

/** The lines a pull request's close ends, and whose runs say which sha was last judged. */
export const FLOOR_REVIEW_LINES: readonly string[] = [
  REVIEW_LINE,
  RECHECK_LINE,
  REPLY_LINE,
];

const RUNS_READ_PER_REPO = 200;

export interface ReviewRunsFloor {
  runs: Pick<FloorClient["runs"], "list">;
}

export interface PullRequestRef {
  repo: string;
  prNumber: number;
}

export async function hasReviewedPr(
  floor: ReviewRunsFloor,
  target: PullRequestRef,
): Promise<boolean> {
  const runs = await reviewRunsForPr(floor, target);

  return runs.some((run) => run.lineId === REVIEW_LINE);
}

/** How many review-family runs of this pull request the floor still has open: what "a review is in flight" means now that reviews run there. Zero on a deployment with no floor. */
export async function openFloorReviewCount(
  floor: ReviewRunsFloor | null,
  target: PullRequestRef,
): Promise<number> {
  if (!floor) {
    return 0;
  }
  const runs = await reviewRunsForPr(floor, target);

  return runs.filter(isOpen).length;
}

/** Every review-family run of one pull request, newest first. Read by repository and matched on `pr_url` here, because only the review line keys its run on the pull request: a re-check or a reply that joined an open review would judge nothing. */
export async function reviewRunsForPr(
  floor: ReviewRunsFloor,
  target: PullRequestRef,
): Promise<RunView[]> {
  const url = pullRequestUrl(target.repo, target.prNumber);
  const page = await floor.runs.list(
    { repo: floorRepoOf(target.repo) },
    { limit: RUNS_READ_PER_REPO },
  );

  return page.items.filter(
    (run) =>
      FLOOR_REVIEW_LINES.includes(run.lineId) &&
      startValue(run, "pr_url") === url,
  );
}

export function isOpen(run: RunView): boolean {
  return run.finishedAt === null;
}

const VERDICT_LINES: readonly string[] = [REVIEW_LINE, RECHECK_LINE];

/** The sha the last posted verdict judged, from runs newest first. Only a review or re-check that settled as `success` posted one: an open, failed or cancelled run judged nothing, and naming its sha would leave its commits unread. */
export function lastJudgedSha(runs: readonly RunView[]): string | undefined {
  const judged = runs.filter(
    (run) => VERDICT_LINES.includes(run.lineId) && run.outcome === "success",
  );

  return judged.flatMap(headShaOf)[0];
}

export function headShaOf(run: RunView): string[] {
  const sha = startValue(run, "head_sha");

  return sha ? [sha] : [];
}

export function startValue(run: RunView, name: string): string | undefined {
  const startItems: Partial<Record<string, Item>> = run.startItems;

  return startItems[name]?.ref;
}
