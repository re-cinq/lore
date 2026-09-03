import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import { errorMessage } from "@re-cinq/lore-shared";
import { toRow } from "@re-cinq/lore-shared/lib/row.js";
import { wireSchema } from "@re-cinq/lore-shared/lib/wire-schema.js";
import { RepoSchema, REPO_COLUMNS } from "@re-cinq/lore-shared/models/repo.js";
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

// Defaults to the max page so orgs with <=100 repos still get them all in one call (pre-pagination behavior).
const ReposQuery = z.object({
  limit: clampedLimit.default(100),
  offset: offsetParam,
});

type ReposQuery = z.infer<typeof ReposQuery>;

// Repo model keyed by its COLUMNS plus two render counts; snake_case because mcp-server proxies this route and reads `full_name`.
const RepoListResponse = z.object({
  repos: z.array(
    wireSchema(RepoSchema, REPO_COLUMNS).extend({
      task_count: z.number(),
      active_agents: z.number(),
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

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const { limit, offset } = request.query as unknown as ReposQuery;

      try {
        const { repos, total } = await getOnboardedReposWithCounts(
          pool,
          limit,
          offset,
        );

        return h.response({
          repos: repos.map(({ taskCount, activeAgents, ...repo }) => ({
            ...toRow(REPO_COLUMNS, repo),
            task_count: taskCount,
            active_agents: activeAgents,
          })),
          total,
          limit,
          offset,
        });
      } catch (err) {
        console.error("[repos] API error:", errorMessage(err));

        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
