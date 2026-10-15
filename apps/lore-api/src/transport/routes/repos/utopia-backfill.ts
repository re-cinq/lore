import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { zodResponse } from "../../http/zod-response.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { withPool } from "../with-pool.js";
import {
  backfillDepsFor,
  backfillRepo,
} from "../../../work/utopia/utopia-backfill.js";
import { enforceRepoHeld, enforceUtopiaConfigured } from "./utopia-setup.js";

const UtopiaBackfillSummarySchema = z.object({
  commit: z.string(),
  documents: z.number(),
  created: z.number(),
  updated: z.number(),
  unchanged: z.number(),
  failed: z.array(z.string()),
});

/** POST /api/repos/{owner}/{repo}/utopia/backfill — every spec and ADR on the repo's default branch, mirrored into its Utopia knowledge base (specs/utopia-graph-mirror). */
export function utopiaBackfillRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/utopia/backfill",
    options: zodResponse(bearerScope("admin"), UtopiaBackfillSummarySchema, {
      name: "UtopiaBackfillSummary",
      description:
        "The commit the specs and ADRs were read at, how many were mirrored, Utopia's created/updated/unchanged item counts, and each document that did not land whole",
      errors: [404, 409],
    }),
    handler: withPool(getPool, serveUtopiaBackfill),
  };
}

async function serveUtopiaBackfill(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const repo = `${request.params.owner}/${request.params.repo}`;

  enforceUtopiaConfigured();
  await enforceRepoHeld(pool, repo);
  const deps = await backfillDepsFor(pool, repo);

  enforceTrue(
    deps,
    apiError(409, { code: "utopia_not_set_up" }),
    `${repo} has no Utopia source and this deployment cannot set one up: run POST /api/repos/${repo}/utopia/setup first`,
  );

  return h.response(await backfillRepo(deps));
}
