import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { rethrowBoom, apiError } from "../../../server/api-error.js";
import { errorMessage } from "@re-cinq/lore-shared";
// Server-side because it needs GitHub App credentials — `lore_get_pr_status` proxies here instead of carrying octokit.

import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { fetchPrStatus } from "../../../platform/github-client.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { repoFullName } from "../common-schemas.js";

const PrStatusQuery = z.object({
  repo: repoFullName,
  pr_number: z.coerce.number().int().positive(),
});

type PrStatusQuery = z.infer<typeof PrStatusQuery>;

// A GitHub read, not a table read, so this shape is stated rather than derived; mirrors `PRDetails` in @re-cinq/lore-shared.
const PrStatusSchema = z.object({
  url: z.string(),
  number: z.number(),
  title: z.string(),
  state: z.enum(["open", "closed", "merged"]),
  draft: z.boolean(),
  mergeable: z.boolean(),
  checksStatus: z.enum(["success", "failure", "pending", "none"]),
  reviewStatus: z.enum(["approved", "changes_requested", "pending", "none"]),
  computedStatus: z.enum([
    "merged",
    "closed",
    "draft",
    "checks-failing",
    "changes-requested",
    "approved",
    "open",
  ]),
});

export function prStatusRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/pr-status",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(PrStatusQuery) },
      },
      PrStatusSchema,
      {
        name: "PrStatus",
        description: "Checks, reviews and the computed state of a PR",
      },
    ),
    handler: async (request, h) => {
      const { repo, pr_number: prNumber } =
        request.query as unknown as PrStatusQuery;

      try {
        const result = await fetchPrStatus(repo, prNumber);

        enforceTrue(
          result,
          apiError(424),
          "GitHub not configured. Set GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID or GITHUB_TOKEN.",
        );

        return h.response(result);
      } catch (err) {
        // A guard's refusal already carries its status; only an unexpected failure is this block's to shape.
        rethrowBoom(err);

        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
