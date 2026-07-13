import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { getOnboardedReposWithCounts } from "../../../features/repo/repo-onboard.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
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

export function reposRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos",
    options: {
      ...bearerScope("read"),
      validate: { query: zodValidate(ReposQuery) },
    },
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
