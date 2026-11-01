import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import type { ZodType } from "zod";
import { zodResponse } from "../../../http/zod-response.js";
import { bearerScope } from "../../../http/bearer-scope.js";
import { withPool } from "../../with-pool.js";
import type { BackfillDeps } from "../../../../work/utopia/utopia-backfill.js";
import { heldBackfillDeps } from "./backfill.js";

export interface UtopiaWalkRoute<T extends object> {
  /** The path's last segment, under `/api/repos/{owner}/{repo}/utopia/`. */
  segment: string;
  schema: ZodType<T>;
  name: string;
  description: string;
  walk(deps: BackfillDeps): Promise<T>;
}

/** An admin POST with no body that runs one of the repo's Utopia walks and answers its summary; its 503, 404 and 409 are the backfill route's. */
export function utopiaWalkRoute<T extends object>(
  getPool: () => Pool | null,
  route: UtopiaWalkRoute<T>,
): ServerRoute {
  return {
    method: "POST",
    path: `/api/repos/{owner}/{repo}/utopia/${route.segment}`,
    options: zodResponse(bearerScope("admin"), route.schema, {
      name: route.name,
      description: route.description,
      errors: [404, 409],
    }),
    handler: withPool(getPool, async (pool, request, h) => {
      const repo = `${request.params.owner}/${request.params.repo}`;

      return h.response(await route.walk(await heldBackfillDeps(pool, repo)));
    }),
  };
}
