// What the floor holds about one pull request's reviews: the read side of the review lines, for everything in Lore that asks whether a review ran or is still running.
import type { FloorClient, Item, RunView } from "@re-cinq/floor-client";
import type { PullCommit } from "../../outbound/project/pulls/pull-requests-port.js";
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

/** A re-check or reply line's newest runs: about ten days of a busy repository. */
const RUNS_READ_PER_LINE = 200;

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

/** Every review-family run of one pull request, newest first. Each line is read on its own: a busy repository's newest runs are mostly other lines', and a window over all of them lost a morning's review by night, so a push read as a pull request never reviewed (#3061, 2026-10-23). The review line keys its run on the pull request and is asked for that subject; a re-check keys on its sha and a reply on its review, so their lines are read and matched on `pr_url`. */
export async function reviewRunsForPr(
  floor: ReviewRunsFloor,
  target: PullRequestRef,
): Promise<RunView[]> {
  const url = pullRequestUrl(target.repo, target.prNumber);
  const repo = floorRepoOf(target.repo);
  const pages = await Promise.all([
    floor.runs.list({ repo, line: REVIEW_LINE, subject: `pr_url:${url}` }),
    floor.runs.list(
      { repo, line: RECHECK_LINE },
      { limit: RUNS_READ_PER_LINE },
    ),
    floor.runs.list({ repo, line: REPLY_LINE }, { limit: RUNS_READ_PER_LINE }),
  ]);

  return pages
    .flatMap((page) => page.items)
    .filter((run) => startValue(run, "pr_url") === url)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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

/** Where the last verdict left off: the sha it judged and the commits pushed since. After a rebase the judged commit is no longer on the branch, so there is no range and the whole pull request is new again. */
export function rangeSince(
  commits: readonly PullCommit[],
  lastSha: string | undefined,
): { sinceSha?: string; newCommitMessages: string[] } {
  const judged = lastSha ? commits.findIndex((c) => c.sha === lastSha) : -1;

  return judged < 0
    ? { newCommitMessages: [] }
    : {
        sinceSha: lastSha,
        newCommitMessages: commits.slice(judged + 1).map((c) => c.message),
      };
}

/** Every sha a review or re-check of the pull request finished judging. */
export function judgedShas(runs: readonly RunView[]): string[] {
  return runs
    .filter(
      (run) => VERDICT_LINES.includes(run.lineId) && run.outcome === "success",
    )
    .flatMap(headShaOf);
}
