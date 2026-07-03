import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { ingestFiles } from "../../../features/spec-trace/ingest.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { rawBody } from "../../../server/raw-body.js";
import { triggerAgentSpecCoverageValidate } from "../helpers.js";

export function ingestRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/ingest",
    options: { ...bearerScope("write"), payload: { parse: false } },
    handler: async (request, h) => {
      const pool = getPool();
      if (!pool) return h.response({ error: "database not available" }).code(503);
      try {
        const { files, repo, commit } = JSON.parse(rawBody(request));
        if (!Array.isArray(files) || !repo) {
          return h.response({ error: "required: files (array of paths or {path,content}), repo (string)" }).code(400);
        }
        const result = await ingestFiles(pool, files, repo, commit || "HEAD");
        // Post-ingest fan-out: re-link tests against any changed specs. Fire-and-
        // forget (fired before the response returns, but it never touches it) —
        // the content-hash gate elides the work when nothing relevant changed.
        // Gated on at least one file actually landing.
        const landed = Array.isArray(result?.results)
          ? result.results.some((r: { status?: string }) => r.status === "ingested" || r.status === "deleted")
          : false;
        if (landed) void triggerAgentSpecCoverageValidate(pool, repo);
        return h.response(result);
      } catch (err: any) {
        console.error("[ingest] API error:", err.message);
        return h.response({ error: err.message }).code(500);
      }
    },
  };
}
