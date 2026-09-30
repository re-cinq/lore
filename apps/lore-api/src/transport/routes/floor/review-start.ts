// POST /api/review/start — the manual "Trigger review" entry, the UI twin of an `@lore review` comment: a click is explicit intent, so it is forced past the auto_review gate.
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  startReview,
  type ReviewStartDeps,
} from "@re-cinq/lore-shared/review/floor-review-start.js";
import { projectFor } from "../../../outbound/project-boot.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";

const ReviewStartBody = z.object({
  repo: z.string().min(1),
  pr_number: z.number().int().positive(),
});

const ReviewStarted = z.object({ started: z.string().nullable() });

export type ReviewDepsFor = (repo: string) => Promise<ReviewStartDeps>;

const REVIEW_START_OPTIONS = zodResponse(
  {
    ...bearerScope("task"),
    validate: { payload: zodValidate(ReviewStartBody) },
  },
  ReviewStarted,
  {
    name: "ReviewStarted",
    status: 202,
    description:
      "A code-review run was started on the floor for the pull request, or joined if one is already open; null when the pull request is not open",
    errors: [400],
  },
);

export function reviewStartRoute(
  depsFor: ReviewDepsFor = productionDeps,
): ServerRoute {
  return {
    method: "POST",
    path: "/api/review/start",
    options: REVIEW_START_OPTIONS,
    handler: (request, h) => serveReviewStart(depsFor, request, h),
  };
}

async function productionDeps(repo: string): Promise<ReviewStartDeps> {
  const { pulls, issues } = await projectFor(repo);

  return {
    floor: floorClient(),
    pulls,
    issues,
    uiUrl: process.env.LORE_UI_URL,
  };
}

async function serveReviewStart(
  depsFor: ReviewDepsFor,
  request: Request,
  h: ResponseToolkit,
) {
  const asked = request.payload as z.infer<typeof ReviewStartBody>;

  return h.response(await handleReviewStart(depsFor, asked)).code(202);
}

export async function handleReviewStart(
  depsFor: ReviewDepsFor,
  asked: z.infer<typeof ReviewStartBody>,
): Promise<z.infer<typeof ReviewStarted>> {
  const started = await startReview(await depsFor(asked.repo), {
    repo: asked.repo,
    prNumber: asked.pr_number,
    autoReview: true,
    forced: true,
  });

  return { started };
}
