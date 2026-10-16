import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import {
  UtopiaCommitsSummarySchema,
  type UtopiaCommitsSummary,
} from "@re-cinq/lore-shared/utopia/backfill-summary.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { withPool } from "../with-pool.js";
import { mirrorBranchCommits } from "../../../work/utopia/utopia-commits.js";
import { heldBackfillDeps } from "./utopia-backfill.js";

const UtopiaCommitsBody = z
  .object({
    /** The branch that was pushed; absent, the default branch. Any other branch is skipped: Utopia holds the default branch's history alone. */
    branch: z.string().optional(),
  })
  .nullable();

type UtopiaCommitsBody = z.infer<typeof UtopiaCommitsBody>;

/** POST /api/repos/{owner}/{repo}/utopia/commits — the default branch's commits above the stored cursor, mirrored into the repo's Utopia knowledge base (specs/utopia-graph-mirror FR11). */
export function utopiaCommitsRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/utopia/commits",
    options: zodResponse(
      {
        ...bearerScope("admin"),
        validate: { payload: zodValidate(UtopiaCommitsBody) },
      },
      UtopiaCommitsSummarySchema,
      {
        name: "UtopiaCommitsSummary",
        description:
          "The cursor the walk started above, the newest commit pushed, Utopia's created/updated/unchanged item counts, and the commit the walk stopped at; skipped names a branch that is not the default one",
        errors: [400, 404, 409],
      },
    ),
    handler: withPool(getPool, serveUtopiaCommits),
  };
}

const NOT_DEFAULT_BRANCH = "not the default branch";

async function serveUtopiaCommits(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const repo = `${request.params.owner}/${request.params.repo}`;
  const asked = (request.payload as UtopiaCommitsBody)?.branch;
  const deps = await heldBackfillDeps(pool, repo);
  const branch = await deps.files.defaultBranch();

  return h.response(
    asked !== undefined && asked !== branch
      ? skippedWalk(asked)
      : await mirrorBranchCommits(deps.history, branch),
  );
}

function skippedWalk(branch: string): UtopiaCommitsSummary {
  return {
    branch,
    from: null,
    to: null,
    commits: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    failed: [],
    skipped: NOT_DEFAULT_BRANCH,
  };
}
