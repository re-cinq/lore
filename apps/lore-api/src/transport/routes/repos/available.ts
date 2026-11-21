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
import {
  readableReposOf,
  repoLevel,
  SPANS_REPOS,
} from "../../http/repo-guard.js";
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
      { ...bearerScope("read"), ...repoLevel("read", SPANS_REPOS) },
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
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  try {
    const available = await getAvailableRepos(pool);

    return h.response(visibleTo(available, readableReposOf(request)));
  } catch (err) {
    return githubFailureResponse(err, h, "installation repositories");
  }
}

function visibleTo<T extends { full_name: string }>(
  repos: T[],
  readable: string[] | null,
): T[] {
  if (readable === null) {
    return repos;
  }
  const allowed = readable.map((name) => name.toLowerCase());

  return repos.filter(({ full_name }) =>
    allowed.includes(full_name.toLowerCase()),
  );
}
