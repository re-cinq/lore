import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../http/api-error.js";
import { zodResponse } from "../../http/zod-response.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { ingestFiles } from "../../../work/spec-trace/ingest.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
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
const IngestResultSchema = z.record(z.string(), z.unknown());

/** Stores posted content into a repo's context immediately, rather than waiting for the nightly pass. */
async function serveIngest(
  getPool: () => Pool | null,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const pool = getPool();

  enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

  try {
    const { files, repo, commit } = request.payload as IngestBody;
    const result = await ingestFiles(pool, files, repo, commit || "HEAD");
    // Fire-and-forget test re-link (gate: content-hash, landed files only).
    const landed = Array.isArray(result.results)
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
}

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
    handler: (request, h) => serveIngest(getPool, request, h),
  };
}
