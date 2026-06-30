import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { mergePersistentFeatures } from "@re-cinq/lore-shared";
import { projectFor } from "../../../platform/project-boot.js";
import { json } from "../http.js";

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
const TRACE_RE = /^\/api\/repos\/([^/]+)\/([^/]+)\/trace\/(specs|spec-summaries|adrs|adr-summaries|document|source|graph|ring)(?:\?(.*))?$/;

export async function handleTraceRoute(req: IncomingMessage, res: ServerResponse, _pool: Pool | null): Promise<void> {
  const match = (req.url || "").match(TRACE_RE);
  if (!match) {
    json(res, 404, { error: "not found" });
    return;
  }
  const [, owner, repo, kind, queryString] = match;
  const filePath = new URLSearchParams(queryString ?? "").get("path") ?? "";

  try {
    const project = await projectFor(`${owner}/${repo}`);
    const trace = project.trace;
    if (kind === "specs") return json(res, 200, { specs: await trace.specs() });
    if (kind === "spec-summaries") return json(res, 200, { summaries: await trace.specSummaries() });
    if (kind === "adrs") return json(res, 200, { adrs: await trace.adrs() });
    if (kind === "adr-summaries") return json(res, 200, { summaries: await trace.adrSummaries() });
    if (kind === "graph") {
      // Make persistent lore.features the source of truth for Feature nodes
      // (ADR-027): enrich/replace the computed folder nodes, inject drafts.
      // Tolerate a not-yet-migrated lore.features (42P01) — the graph must still
      // render its computed nodes in the window before migration 0017 lands.
      const [graph, features] = await Promise.all([
        trace.graph(),
        project.features.list().catch((err) => {
          if ((err as { code?: string }).code === "42P01") return [];
          throw err;
        }),
      ]);
      return json(
        res,
        200,
        mergePersistentFeatures(
          graph,
          features.map((f) => ({ id: f.id, title: f.title, path: f.path, status: f.status })),
        ),
      );
    }
    if (!filePath) return json(res, 400, { error: "path query param required" });
    if (kind === "document") return json(res, 200, await trace.document(filePath));
    if (kind === "ring") return json(res, 200, await trace.ring(filePath));
    return json(res, 200, { source: await trace.source(filePath) });
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
