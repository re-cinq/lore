import type { ServerRoute } from "@hapi/hapi";
import { createDgraphClient, listAllAdrDocuments } from "@re-cinq/lore-shared";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

/** GET /api/trace/adrs — cross-repo ADR list for the global viewer (not per-repo, so not via Project). */
export function traceAdrsRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/trace/adrs",
    options: bearerScope("read"),
    handler: async (_request, h) => {
      const dgraph = createDgraphClient(process.env);

      if (!dgraph) {
        return h.response({ adrs: [] });
      }

      try {
        return h.response({ adrs: await listAllAdrDocuments(dgraph) });
      } catch (err) {
        return h
          .response({ error: err instanceof Error ? err.message : String(err) })
          .code(500);
      }
    },
  };
}
