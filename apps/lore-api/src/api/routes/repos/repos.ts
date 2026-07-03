import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { getOnboardedReposWithCounts } from "../../../features/repo/repo-onboard.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

export function reposRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos",
    options: bearerScope("read"),
    handler: async (_request, h) => {
      const pool = getPool();
      if (!pool) return h.response({ error: "database not available" }).code(503);
      try {
        return h.response(await getOnboardedReposWithCounts(pool));
      } catch (err: any) {
        console.error("[repos] API error:", err.message);
        return h.response({ error: err.message }).code(500);
      }
    },
  };
}
