import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { mergePersistentFeatures } from "@re-cinq/lore-shared";
import { projectFor } from "../../../platform/project-boot.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";

// `kind` keeps its Set check (404 unknown, not 400); only the free-form `path`
// query is bounded here.
const TraceQuery = z.object({ path: z.string().max(1024).optional() });
type TraceQuery = z.infer<typeof TraceQuery>;

/**
 * GET /api/repos/:owner/:repo/trace/{specs|adrs|document|source|graph|ring} —
 * the spec-traceability graph as source of truth, served through `project.trace`
 * (the shared Project facade, NOT direct DB queries). web-ui consumes this
 * instead of reading Postgres chunks / Dgraph directly.
 *   - specs|adrs            → { specs|adrs: string[] } document paths
 *   - document?path=<file>  → TraceDocument (ordered sections+statements+coverage)
 *   - source?path=<file>    → { source: string|null } byte-exact reassembly
 *   - graph                 → SpecGraph ({nodes, links}) force-graph
 *   - ring?path=<file>      → SpecRing (sections + per-statement coverage)
 */
const TRACE_KINDS = new Set(["specs", "spec-summaries", "adrs", "adr-summaries", "document", "source", "graph", "ring"]);

export function traceRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/trace/{kind}",
    options: { ...bearerScope("read"), validate: { query: zodValidate(TraceQuery) } },
    handler: async (request, h) => {
      const kind = request.params.kind;
      if (!TRACE_KINDS.has(kind)) return h.response({ error: "not found" }).code(404);
      const { path: filePath = "" } = request.query as TraceQuery;

      try {
        const trace = (await projectFor(`${request.params.owner}/${request.params.repo}`)).trace;
        if (kind === "specs") return h.response({ specs: await trace.specs() });
        if (kind === "spec-summaries") return h.response({ summaries: await trace.specSummaries() });
        if (kind === "adrs") return h.response({ adrs: await trace.adrs() });
        if (kind === "adr-summaries") return h.response({ summaries: await trace.adrSummaries() });
        if (kind === "graph") {
          // Make persistent lore.features the source of truth for Feature nodes
          // (ADR-027). Tolerate a not-yet-migrated lore.features (42P01).
          const project = await projectFor(`${request.params.owner}/${request.params.repo}`);
          const [graph, features] = await Promise.all([
            trace.graph(),
            project.features.list().catch((err) => {
              if ((err as { code?: string }).code === "42P01") return [];
              throw err;
            }),
          ]);
          return h.response(
            mergePersistentFeatures(
              graph,
              features.map((f) => ({ id: f.id, title: f.title, path: f.path, status: f.status })),
            ),
          );
        }
        if (!filePath) return h.response({ error: "path query param required" }).code(400);
        if (kind === "document") return h.response(await trace.document(filePath));
        if (kind === "ring") return h.response(await trace.ring(filePath));
        return h.response({ source: await trace.source(filePath) });
      } catch (err) {
        return h.response({ error: err instanceof Error ? err.message : String(err) }).code(500);
      }
    },
  };
}
