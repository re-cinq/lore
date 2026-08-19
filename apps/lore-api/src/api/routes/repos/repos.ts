import { errorMessage } from "@re-cinq/lore-shared";
import { RepoSchema } from "@re-cinq/lore-shared/models/repo.js";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { getOnboardedReposWithCounts } from "../../../features/repo/repo-onboard.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import {
  DB_UNAVAILABLE,
  clampedLimit,
  offsetParam,
} from "../common-schemas.js";

// Defaults to the max page so orgs with <=100 onboarded repos still get them all
// in one call, preserving the pre-pagination "returns every repo" behavior.
const ReposQuery = z.object({
  limit: clampedLimit.default(100),
  offset: offsetParam,
});

type ReposQuery = z.infer<typeof ReposQuery>;

/** The list body: the `Repo` model plus the counts this page renders beside it. */
const RepoListResponse = z.object({
  repos: z.array(
    RepoSchema.extend({
      taskCount: z.number(),
      activeAgents: z.number(),
    }),
  ),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export function reposRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(ReposQuery) },
      },
      RepoListResponse,
      { name: "RepoList", description: "A page of onboarded repos" },
    ),
    handler: async (request, h) => {
      const pool = getPool();

      if (!pool) {
        return h.response({ error: DB_UNAVAILABLE }).code(503);
      }
      const { limit, offset } = request.query as unknown as ReposQuery;

      try {
        const result = await getOnboardedReposWithCounts(pool, limit, offset);

        return h.response({ ...result, limit, offset });
      } catch (err) {
        console.error("[repos] API error:", errorMessage(err));

        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
