import { zodResponse } from "../../../server/plugins/zod-response.js";
import { z } from "zod";
import type { ServerRoute } from "@hapi/hapi";
import { createDgraphClient, listAllSpecDocuments } from "@re-cinq/lore-shared";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

/** GET /api/trace/specs — cross-repo spec list for the global viewer (not per-repo, so not via Project). */
/** Every spec the graph holds; empty when no graph is configured. */
const SpecListSchema = z.object({ specs: z.array(z.record(z.unknown())) });

export function traceSpecsRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/trace/specs",
    options: zodResponse(bearerScope("read"), SpecListSchema, {
      name: "SpecList",
      description: "Every spec in the traceability graph",
    }),
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
