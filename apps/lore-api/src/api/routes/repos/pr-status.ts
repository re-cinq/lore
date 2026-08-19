import { zodResponse } from "../../../server/plugins/zod-response.js";
import { errorMessage } from "@re-cinq/lore-shared";
/**
 * `GET /api/pr-status?repo=owner/name&pr_number=N` — live PR/CI/review verdict
 * from GitHub. Server-side because it needs the GitHub App credentials; the
 * local `lore_get_pr_status` tool proxies here instead of carrying octokit.
 */

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

/** A pull request's computed status, as the task page renders it. */
const PrStatusSchema = z.record(z.unknown());

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

        if (!result) {
          // 424 (not 502): a missing-GitHub-credentials config gap is deterministic,
          // so the proxy must classify it non-retriable and not burn its retry budget
          // or report it as a transient Lore-API outage.
          return h
            .response({
              error:
                "GitHub not configured. Set GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID or GITHUB_TOKEN.",
            })
            .code(424);
        }

        return h.response(result);
      } catch (err) {
        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
