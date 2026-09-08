import { errorMessage } from "@re-cinq/lore-shared";
import { toRow } from "@re-cinq/lore-shared/lib/row.js";
import { wireSchema } from "@re-cinq/lore-shared/lib/wire-schema.js";
import { RepoSchema, REPO_COLUMNS } from "@re-cinq/lore-shared/models/repo.js";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { getOnboardedReposWithCounts } from "../../../work/repo/repo-onboard.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { clampedLimit, offsetParam } from "../common-schemas.js";
import { withPool } from "../with-pool.js";

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

/** One page in wire shape: the stored columns per repo, plus the two counts the list renders. */
async function repoListPage(pool: Pool, limit: number, offset: number) {
  const { repos, total } = await getOnboardedReposWithCounts(
    pool,
    limit,
    offset,
  );

  return {
    repos: repos.map(({ taskCount, activeAgents, ...repo }) => ({
      ...toRow(REPO_COLUMNS, repo),
      task_count: taskCount,
      active_agents: activeAgents,
    })),
    total,
    limit,
    offset,
  };
}

/** A page of onboarded repos with their per-repo metadata and task counts. */
async function serveRepoList(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { limit, offset } = request.query as unknown as ReposQuery;

  try {
    return h.response(await repoListPage(pool, limit, offset));
  } catch (err) {
    console.error("[repos] API error:", errorMessage(err));

    return h.response({ error: errorMessage(err) }).code(500);
  }
}

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
    handler: withPool(getPool, serveRepoList),
  };
}
