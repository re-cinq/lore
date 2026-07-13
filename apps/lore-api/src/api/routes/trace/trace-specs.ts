import type { ServerRoute } from "@hapi/hapi";
import { createDgraphClient, listAllSpecDocuments } from "@re-cinq/lore-shared";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

/** GET /api/trace/specs — cross-repo spec list for the global viewer (not per-repo, so not via Project). */
export function traceSpecsRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/trace/specs",
    options: bearerScope("read"),
    handler: async (_request, h) => {
      const dgraph = createDgraphClient(process.env);

      if (!dgraph) {
        return h.response({ specs: [] });
      }

      try {
        return h.response({ specs: await listAllSpecDocuments(dgraph) });
      } catch (err) {
        return h
          .response({ error: err instanceof Error ? err.message : String(err) })
          .code(500);
      }
    },
  };
}
