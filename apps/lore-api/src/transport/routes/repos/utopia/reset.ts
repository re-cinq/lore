import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import {
  zodResponse,
  type ZodResponseOptions,
} from "../../../http/zod-response.js";
import { bearerScope } from "../../../http/bearer-scope.js";
import { repoLevel } from "../../../http/repo-guard.js";
import { withPool } from "../../with-pool.js";
import { clearUtopiaCursors } from "../../../../outbound/utopia/sources.js";
import { enforceRepoHeld, enforceUtopiaConfigured } from "./setup.js";

const UtopiaResetSummarySchema = z.object({
  /** The walk cursors dropped from `settings.utopia`. */
  cursors_cleared: z.array(z.string()),
});

const ADMIN_OPTIONS = { ...bearerScope("admin"), ...repoLevel("admin") };
const RESET_DOC: ZodResponseOptions = {
  name: "UtopiaResetSummary",
  description: "The walk cursors that were dropped",
  errors: [404],
};

/** POST /api/repos/{owner}/{repo}/utopia/reset — start the repo's commit and tracker walks over from the beginning, so the text sources fill with its whole history and not only what came after the cursors (specs/utopia-graph-mirror FR19). */
export function utopiaResetRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/utopia/reset",
    options: zodResponse(ADMIN_OPTIONS, UtopiaResetSummarySchema, RESET_DOC),
    handler: withPool(getPool, async (pool, request, h) => {
      const repo = `${request.params.owner}/${request.params.repo}`;

      enforceUtopiaConfigured();
      await enforceRepoHeld(pool, repo);

      return h.response({
        cursors_cleared: await clearUtopiaCursors(pool, repo),
      });
    }),
  };
}
