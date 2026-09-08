import { zodResponse } from "../../http/zod-response.js";
import { z } from "zod";
import type { ResponseObject, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { createDgraphClient, listAllAdrDocuments } from "@re-cinq/lore-shared";
import { bearerScope } from "../../http/bearer-scope.js";

/** GET /api/trace/adrs — cross-repo ADR list for the global viewer (not per-repo, so not via Project). */
/** Every ADR the graph holds; empty when no graph is configured. */
const AdrListSchema = z.object({
  adrs: z.array(z.record(z.string(), z.unknown())),
});

/** Every adr the graph holds. A deployment with no graph configured answers with an empty list rather than an error — the global viewer is readable before any projection has run. */
async function serveAdrList(h: ResponseToolkit): Promise<ResponseObject> {
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
}

export function traceAdrsRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/trace/adrs",
    options: zodResponse(bearerScope("read"), AdrListSchema, {
      name: "AdrList",
      description: "Every ADR in the traceability graph",
    }),
    handler: (_request, h) => serveAdrList(h),
  };
}
