import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
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

/** What the ingest wrote — counts per kind. */
const IngestResultSchema = z.record(z.unknown());

export function ingestRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/ingest",
    options: zodResponse(
      {
        ...bearerScope("write"),
        validate: { payload: zodValidate(IngestBody) },
      },
      IngestResultSchema,
      {
        name: "IngestResult",
        description: "What the ingest stored",
        errors: [400],
      },
    ),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

      try {
        const { files, repo, commit } = request.payload as IngestBody;
        const result = await ingestFiles(pool, files, repo, commit || "HEAD");
        // Fire-and-forget test re-link (gate: content-hash, landed files only).
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
