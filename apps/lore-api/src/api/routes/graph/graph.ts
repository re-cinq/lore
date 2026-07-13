import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { queryLiveGraph } from "@re-cinq/lore-server-core/features/memory/graph.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { repoFullName, boolFlag } from "../common-schemas.js";

const GraphQuery = z.object({
  entity: z.string().optional(),
  relation_type: z.string().optional(),
  repo: repoFullName.optional(),
  include_invalidated: boolFlag,
});
type GraphQuery = z.infer<typeof GraphQuery>;

/**
 * GET /api/graph — read the live knowledge graph. The remote counterpart of the
 * `lore_query_graph` MCP tool, so a local stdio server (no Postgres) can proxy here
 * over LORE_API_URL instead of requiring a direct DB connection.
 */
export function graphRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/graph",
    options: {
      ...bearerScope("read"),
      validate: { query: zodValidate(GraphQuery) },
    },
    handler: async (request, h) => {
      const pool = getPool();
      if (!pool)
        return h
          .response({ error: "knowledge graph requires PostgreSQL" })
          .code(503);

      const {
        entity,
        relation_type: relationType,
        repo,
        include_invalidated: includeInvalidated,
      } = request.query as unknown as GraphQuery;
      try {
        const results = await queryLiveGraph(
          pool,
          entity,
          relationType,
          repo,
          includeInvalidated,
        );
        return h.response(results);
      } catch (err: any) {
        return h.response({ error: err.message }).code(500);
      }
    },
  };
}
