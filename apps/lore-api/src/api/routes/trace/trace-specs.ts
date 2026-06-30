import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { createDgraphClient, listAllSpecDocuments } from "@re-cinq/lore-shared";
import { json } from "../http.js";

/** GET /api/trace/specs — cross-repo spec list for the global viewer (not per-repo, so not via Project). */
export async function handleGlobalTraceSpecs(_req: IncomingMessage, res: ServerResponse, _pool: Pool | null): Promise<void> {
  const dgraph = createDgraphClient(process.env);
  if (!dgraph) return json(res, 200, { specs: [] });
  try {
    return json(res, 200, { specs: await listAllSpecDocuments(dgraph) });
  } catch (err) {
    return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
