import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { queryLiveGraph } from "@re-cinq/lore-server-core/features/memory/graph.js";
import { json } from "./http.js";

/**
 * GET /api/graph — read the live knowledge graph. The remote counterpart of the
 * `lore_query_graph` MCP tool, so a local stdio server (no Postgres) can proxy here
 * over LORE_API_URL instead of requiring a direct DB connection.
 */
export async function handleGraph(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  if (!pool) {
    json(res, 503, { error: "knowledge graph requires PostgreSQL" });
    return;
  }
  const url = new URL(req.url!, "http://localhost");
  const entity = url.searchParams.get("entity") || undefined;
  const relationType = url.searchParams.get("relation_type") || undefined;
  const repo = url.searchParams.get("repo") || undefined;
  const includeInvalidated =
    url.searchParams.get("include_invalidated") === "true" || url.searchParams.get("include_invalidated") === "1";
  try {
    const results = await queryLiveGraph(pool, entity, relationType, repo, includeInvalidated);
    json(res, 200, results);
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}
