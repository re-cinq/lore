// GET /api/repos/{owner}/{repo}/code-review — the code-review loop as the Loops tab shows it (specs/auto-review-loop FR-L1): the pull requests under review, the other open ones, and the newest settled reviews.
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { answerRepoRead, onboardedProject } from "../repos/github-read.js";
import type { FloorRunPageOf } from "../floor/floor-runs.js";
import type { FloorRunRow } from "../../../work/floor/floor-run-rows.js";
import {
  CodeReviewSchema,
  REVIEW_LINES,
  reviewQueues,
} from "./review-queues.js";

const RepoParams = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

/** How many of each line's newest runs the page reads: enough to find every open pull request's last review. */
const RUNS_PER_LINE = 30;

export function codeReviewRoute(pageOf: FloorRunPageOf): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/code-review",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { params: zodValidate(RepoParams) },
      },
      CodeReviewSchema,
      {
        name: "CodeReview",
        description:
          "The code-review loop: pull requests under review, the other open ones, and the newest settled reviews",
        errors: [400, 404],
      },
    ),
    handler: (request, h) => serveCodeReview(pageOf, request, h),
  };
}

async function serveCodeReview(
  pageOf: FloorRunPageOf,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  return answerRepoRead(request, h, (fullName) => readQueues(pageOf, fullName));
}

async function readQueues(pageOf: FloorRunPageOf, fullName: string) {
  const project = await onboardedProject(fullName);
  const [pulls, runs] = await Promise.all([
    project.pulls.list(),
    reviewRuns(pageOf, fullName),
  ]);

  return reviewQueues(
    pulls.filter((pull) => pull.state === "open"),
    runs,
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
