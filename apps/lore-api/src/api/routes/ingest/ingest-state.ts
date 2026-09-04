import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { z } from "zod";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";
import { INGEST_DELTA_KINDS } from "./ingest-kinds.js";

/** GET ingest-state (CI half of incremental-ingest handshake); null = full-ingest signal. */

const IngestStateSchema = z.object({
  kind: z.string(),
  commit: z.string().nullable(),
});

const UNDEFINED_TABLE = "42P01";

function isUndefinedTableError(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === UNDEFINED_TABLE;
}

async function lastIngestedCommit(
  pool: Pool,
  repo: string,
  kind: string,
): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ commit_sha: string }>(
      `SELECT commit_sha FROM pipeline.ingest_state
        WHERE repo = $1 AND kind = $2`,
      [repo, kind],
    );

    return rows[0]?.commit_sha ?? null;
  } catch (err) {
    // Unmigrated cluster → full ingest (correct behavior).
    if (!isUndefinedTableError(err)) {
      throw err;
    }

    return null;
  }
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
      const commit = await lastIngestedCommit(pool, repo, kind);

      return h.response({ kind, commit });
    },
  };
}
