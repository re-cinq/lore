import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { getAvailableRepos } from "../../../work/repo/repo-onboard.js";
import { zodResponse } from "../../http/zod-response.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { withPool } from "../with-pool.js";

const AvailableRepoWire = z.object({
  full_name: z.string(),
  owner: z.string(),
  name: z.string(),
});

/** GET /api/repos/available — repos the GitHub App has access to that aren't onboarded yet. */
export function availableReposRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/available",
    options: zodResponse(
      { ...bearerScope("read") },
      z.array(AvailableRepoWire),
      {
        name: "AvailableRepos",
        description: "GitHub App repos not yet onboarded",
      },
    ),
    handler: withPool(getPool, serveAvailableRepos),
  };
}

async function serveAvailableRepos(
  pool: Pool,
  _request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const repos = await getAvailableRepos(pool);

  return h.response(repos).code(200);
}
