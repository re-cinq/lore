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
import { githubFailureResponse } from "./github-read.js";

const AvailableRepoWire = z.object({
  full_name: z.string(),
  owner: z.string(),
  name: z.string(),
});

/** GET /api/repos/available — every repo the GitHub App installation can access that is not onboarded yet; 424 when GitHub is not configured, 500 with the upstream message when it fails. */
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
  try {
    return h.response(await getAvailableRepos(pool));
  } catch (err) {
    return githubFailureResponse(err, h, "installation repositories");
  }
}
