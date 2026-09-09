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
import { reconcileOrphanChunks } from "../../../work/chunks/reconcile-orphans.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import { triggerAgentSpecCoverageValidate } from "../helpers.js";
import { withPool } from "../with-pool.js";

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
    handler: withPool(getPool, serveIngest),
  };
}

/** Stores posted content into a repo's context immediately, rather than waiting for the nightly pass. */
async function serveIngest(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  try {
    const { files, repo, commit } = request.payload as IngestBody;
    const result = await ingestFiles(pool, files, repo, commit || "HEAD");

    // Fire-and-forget test re-link (gate: content-hash, landed files only).
    if (anyFileLanded(result.results)) {
      void triggerAgentSpecCoverageValidate(pool, repo);
      // The store converges on the merge that changed the tree, so a rename's old path cannot outlive it. Merge-time ingest is the only ingestion path since #1880, which is why nothing was reconciling.
      void reconcileOrphanChunks(pool, repo, commit).catch((err) =>
        console.warn("[ingest] reconcile skipped:", errorMessage(err)),
      );
    }

    return h.response(result);
  } catch (err) {
    console.error("[ingest] API error:", errorMessage(err));

    return h.response({ error: errorMessage(err) }).code(500);
  }
}

/** True when at least one posted file actually changed the store — the gate on the re-link trigger. */
function anyFileLanded(results: unknown): boolean {
  return (
    Array.isArray(results) &&
    results.some(
      (r: { status?: string }) =>
        r.status === "ingested" || r.status === "deleted",
    )
  );
}
