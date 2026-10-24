// GET /api/repos/{owner}/{repo}/code-review — the code-review loop as the Loops tab shows it (specs/auto-review-loop FR-L1): the pull requests under review, the other open ones, and the newest settled reviews.
import type { ServerRoute } from "@hapi/hapi";
import { onboardedProject } from "../repos/github-read.js";
import { loopReadRoute } from "../loops/loop-read-route.js";
import { loopPullReads, type LoopPullReads } from "../loops/loop-pull-reads.js";
import type { FloorRunPageOf } from "../floor/floor-runs.js";
import type { FloorRunRow } from "../../../work/floor/floor-run-rows.js";
import {
  CodeReviewSchema,
  RECENT_LIMIT,
  REVIEW_LINES,
  reviewQueues,
} from "./review-queues.js";
import { recentWindow } from "../loops/loop-sections.js";

/** How many of each line's newest runs the page reads: enough to find every open pull request's last review. */
const RUNS_PER_LINE = 30;

export function codeReviewRoute(
  pageOf: FloorRunPageOf,
  reads: LoopPullReads = loopPullReads(),
): ServerRoute {
  return loopReadRoute({
    segment: "code-review",
    schema: CodeReviewSchema,
    name: "CodeReview",
    description:
      "The code-review loop: pull requests under review, the other open ones, and the newest settled reviews",
    read: (fullName, limits) =>
      readQueues(
        { pageOf, reads },
        fullName,
        recentWindow(limits, RECENT_LIMIT),
      ),
  });
}

async function readQueues(
  { pageOf, reads }: { pageOf: FloorRunPageOf; reads: LoopPullReads },
  fullName: string,
  recentLimit: number,
) {
  const project = await onboardedProject(fullName);
  const [pulls, runs] = await Promise.all([
    reads.openPulls(fullName, project.pulls),
    reviewRuns(pageOf, fullName),
  ]);

  return reviewQueues(
    pulls.filter((pull) => pull.state === "open"),
    runs,
    recentLimit,
  );
}

/** The newest runs of each review line, read as the run list reads them so every row carries its mini pipeline. */
async function reviewRuns(
  pageOf: FloorRunPageOf,
  repo: string,
): Promise<FloorRunRow[]> {
  const pages = await Promise.all(
    Object.keys(REVIEW_LINES).map((line) =>
      pageOf({ repo, line, limit: RUNS_PER_LINE }),
    ),
  );

  return pages.flatMap((page) => page.runs);
}
