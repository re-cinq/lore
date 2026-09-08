import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { zodResponse } from "../../http/zod-response.js";
import { z } from "zod";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { bearerScope } from "../../http/bearer-scope.js";
import { INGEST_DELTA_KINDS } from "./ingest-kinds.js";
import { withPool } from "../with-pool.js";
import { storedCommit } from "./ingest-delta-state.js";

/** GET ingest-state (CI half of incremental-ingest handshake); null = full-ingest signal. */

const IngestStateSchema = z.object({
  kind: z.string(),
  commit: z.string().nullable(),
});

/** The last commit ingested for the requested kind, or null when nothing has landed yet. */
async function serveIngestState(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const kind = (request.query as { kind?: string }).kind ?? "";

  enforceTrue(
    INGEST_DELTA_KINDS.has(kind),
    apiError(400),
    `unknown kind "${kind}" — expected one of ${[...INGEST_DELTA_KINDS].join(", ")}`,
  );
  const repo = `${request.params.owner}/${request.params.repo}`;
  const commit = await storedCommit(pool, repo, kind);

  return h.response({ kind, commit });
}

export function ingestStateRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/ingest-state",
    options: zodResponse(bearerScope("read"), IngestStateSchema, {
      name: "IngestState",
      description: "The last commit ingested for a repo and kind",
      errors: [400],
    }),
    handler: withPool(getPool, serveIngestState),
  };
}
