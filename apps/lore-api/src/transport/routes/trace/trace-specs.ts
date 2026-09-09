import { zodResponse } from "../../http/zod-response.js";
import { z } from "zod";
import type { ResponseObject, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { createDgraphClient, listAllSpecDocuments } from "@re-cinq/lore-shared";
import { bearerScope } from "../../http/bearer-scope.js";

/** GET /api/trace/specs — cross-repo spec list for the global viewer (not per-repo, so not via Project). */
/** Every spec the graph holds; empty when no graph is configured. */
const SpecListSchema = z.object({
  specs: z.array(z.record(z.string(), z.unknown())),
});

/** Every spec the graph holds. A deployment with no graph configured answers with an empty list rather than an error — the global viewer is readable before any projection has run. */
async function serveSpecList(h: ResponseToolkit): Promise<ResponseObject> {
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
}

export function traceSpecsRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/trace/specs",
    options: zodResponse(bearerScope("read"), SpecListSchema, {
      name: "SpecList",
      description: "Every spec in the traceability graph",
    }),
    handler: (_request, h) => serveSpecList(h),
  };
}
