import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { ingestFiles } from "../../../features/spec-trace/ingest.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { triggerAgentSpecCoverageValidate } from "../helpers.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

const IngestBody = z.object({
  files: z.array(
    z.union([z.string(), z.object({ path: z.string(), content: z.string() })]),
  ),
  repo: z.string().min(1),
  commit: z.string().optional(),
});

type IngestBody = z.infer<typeof IngestBody>;

export function ingestRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/ingest",
    options: {
      ...bearerScope("write"),
      validate: { payload: zodValidate(IngestBody) },
    },
    handler: async (request, h) => {
      const pool = getPool();

      if (!pool) {
        return h.response({ error: DB_UNAVAILABLE }).code(503);
      }

      try {
        const { files, repo, commit } = request.payload as IngestBody;
        const result = await ingestFiles(pool, files, repo, commit || "HEAD");
        // Post-ingest fan-out: re-link tests against any changed specs. Fire-and-
        // forget (fired before the response returns, but it never touches it) —
        // the content-hash gate elides the work when nothing relevant changed.
        // Gated on at least one file actually landing.
        const landed = Array.isArray(result?.results)
          ? result.results.some(
              (r: { status?: string }) =>
                r.status === "ingested" || r.status === "deleted",
            )
          : false;

        if (landed) {
          void triggerAgentSpecCoverageValidate(pool, repo);
        }

        return h.response(result);
      } catch (err) {
        console.error("[ingest] API error:", errorMessage(err));

        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
