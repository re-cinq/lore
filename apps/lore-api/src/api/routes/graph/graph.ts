import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { queryLiveGraph } from "@re-cinq/lore-server-core/features/memory/graph.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

/**
 * GET /api/graph — read the live knowledge graph. The remote counterpart of the
 * `lore_query_graph` MCP tool, so a local stdio server (no Postgres) can proxy here
 * over LORE_API_URL instead of requiring a direct DB connection.
 */
export function graphRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/graph",
    options: bearerScope("read"),
    handler: async (request, h) => {
      const pool = getPool();
      if (!pool) return h.response({ error: "knowledge graph requires PostgreSQL" }).code(503);

      const q = request.query as Record<string, string | undefined>;
      const entity = q.entity || undefined;
      const relationType = q.relation_type || undefined;
      const repo = q.repo || undefined;
      const includeInvalidated = q.include_invalidated === "true" || q.include_invalidated === "1";
      try {
        const results = await queryLiveGraph(pool, entity, relationType, repo, includeInvalidated);
        return h.response(results);
      } catch (err: any) {
        return h.response({ error: err.message }).code(500);
      }
    },
  };
}
