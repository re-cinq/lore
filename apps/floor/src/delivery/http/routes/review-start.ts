/** POST /api/review/start — the manual "Trigger review" entry (the UI twin of an `@lore review` comment); reuses `startReview` forced, bypassing the auto_review gate + first-review-only since a click is explicit intent. */

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../api-error.js";
import type { ServerRoute } from "@hapi/hapi";
import { projectFor } from "../../../kernel/project-boot.js";
import { startReview } from "../../../jobs/review/code-review.js";
import { rawBody, parseJsonBody } from "../raw-body.js";

interface ReviewStartBody {
  repo?: string;
  pr_number?: number;
}

export const reviewStartRoute: ServerRoute = {
  method: "POST",
  path: "/api/review/start",
  options: { auth: "ingest-token", payload: { parse: false } },
  handler: async (request, h) => {
    const body = parseJsonBody<ReviewStartBody>(
      rawBody(request),
      "review-start",
    );

    enforceTrue(
      typeof body.repo === "string" &&
        body.repo.length > 0 &&
        typeof body.pr_number === "number",
      apiError(400),
      "repo and pr_number are required",
    );
    const project = await projectFor(body.repo as string);
    const id = await startReview(
      project,
      {
        repo: body.repo as string,
        prNumber: body.pr_number as number,
        autoReview: true,
        forced: true,
      },
      process.env.LORE_UI_URL,
    );

    return h.response({ started: id }).code(202);
  },
};
