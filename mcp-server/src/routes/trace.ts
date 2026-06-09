import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { createDgraphClient, listAllSpecDocuments } from "@re-cinq/lore-shared";
import { projectFor } from "../project-boot.js";
import { json } from "./http.js";

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

/**
 * GET /api/repos/:owner/:repo/trace/{specs|adrs|document|source} — the
 * spec-traceability graph as source of truth, served through `project.trace`
 * (the shared Project facade, NOT direct DB queries). web-ui (not a workspace
 * member) consumes this instead of reading Postgres chunks / Dgraph directly.
 *   - specs|adrs            → { specs|adrs: string[] } document paths
 *   - document?path=<file>  → TraceDocument (ordered sections+statements+coverage)
 *   - source?path=<file>    → { source: string|null } byte-exact reassembly
 *   - graph                 → SpecGraph ({nodes, links}) force-graph
 *   - ring?path=<file>      → SpecRing (sections + per-statement coverage)
 */
const TRACE_RE = /^\/api\/repos\/([^/]+)\/([^/]+)\/trace\/(specs|adrs|document|source|graph|ring)(?:\?(.*))?$/;

export async function handleTraceRoute(req: IncomingMessage, res: ServerResponse, _pool: Pool | null): Promise<void> {
  const match = (req.url || "").match(TRACE_RE);
  if (!match) {
    json(res, 404, { error: "not found" });
    return;
  }
  const [, owner, repo, kind, queryString] = match;
  const filePath = new URLSearchParams(queryString ?? "").get("path") ?? "";

  try {
    const trace = (await projectFor(`${owner}/${repo}`)).trace;
    if (kind === "specs") return json(res, 200, { specs: await trace.specs() });
    if (kind === "adrs") return json(res, 200, { adrs: await trace.adrs() });
    if (kind === "graph") return json(res, 200, await trace.graph());
    if (!filePath) return json(res, 400, { error: "path query param required" });
    if (kind === "document") return json(res, 200, await trace.document(filePath));
    if (kind === "ring") return json(res, 200, await trace.ring(filePath));
    return json(res, 200, { source: await trace.source(filePath) });
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
