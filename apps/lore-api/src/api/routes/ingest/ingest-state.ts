import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { z } from "zod";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";
import { INGEST_DELTA_KINDS } from "./ingest-kinds.js";

/**
 * `GET /api/repos/{owner}/{repo}/ingest-state?kind=` — the CI half of the
 * incremental-ingest handshake (specs/ci-incremental-ingest FR1): the commit
 * Lore last ingested for this repo and kind, so the runner can
 * `git diff <commit>..HEAD` and send only the delta. A null commit is the
 * full-ingest signal — nothing recorded yet, or a cluster whose migration has
 * not landed, and both mean the same thing to the caller: diff against
 * nothing, send everything.
 */

const IngestStateSchema = z.object({
  kind: z.string(),
  commit: z.string().nullable(),
});

const UNDEFINED_TABLE = "42P01";

export function ingestStateRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/ingest-state",
    options: zodResponse(bearerScope("read"), IngestStateSchema, {
      name: "IngestState",
      description: "The last commit ingested for a repo and kind",
      errors: [400],
    }),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const kind = (request.query as { kind?: string }).kind ?? "";

      enforceTrue(
        INGEST_DELTA_KINDS.has(kind),
        apiError(400),
        `unknown kind "${kind}" — expected one of ${[...INGEST_DELTA_KINDS].join(", ")}`,
      );
      const repo = `${request.params.owner}/${request.params.repo}`;
      let commit: string | null = null;

      try {
        const { rows } = await pool.query<{ commit_sha: string }>(
          `SELECT commit_sha FROM pipeline.ingest_state
            WHERE repo = $1 AND kind = $2`,
          [repo, kind],
        );

        commit = rows[0]?.commit_sha ?? null;
      } catch (err) {
        // Pre-migration cluster → "never ingested", which correctly makes the
        // caller run a full ingest rather than failing its CI job.
        if (!(
          err instanceof Error &&
          "code" in err &&
          err.code === UNDEFINED_TABLE
        )) {
          throw err;
        }
      }

      return h.response({ kind, commit });
    },
  };
}
