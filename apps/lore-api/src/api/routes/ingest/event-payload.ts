import { errorMessage } from "@re-cinq/lore-shared";
import type { ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

/**
 * The ingest station's payload-by-reference fetch (specs/ingest-station FR3):
 * a test-report body is ~1 MB and cannot ride `station_input` argv, so the pod
 * reads it back from the `pipeline.events` row that scheduled its line. The
 * row's repo must match the path — a token scoped to one repo can't read
 * another repo's payloads through this.
 */
export function eventPayloadRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/events/{id}/payload",
    options: bearerScope("read"),
    handler: async (request, h) => {
      try {
        const repo = `${request.params.owner}/${request.params.repo}`;
        const pool = getPool();

        if (!pool) {
          return h.response({ error: "db not configured" }).code(503);
        }
        const { rows } = await pool.query(
          `SELECT params->'payload' AS payload, repo
             FROM pipeline.events
            WHERE id = $1`,
          [request.params.id],
        );
        const row = rows[0] as
          { payload: unknown; repo: string | null } | undefined;

        if (!row || row.payload == null || row.repo !== repo) {
          return h.response({ error: "not found" }).code(404);
        }

        return h.response(row.payload as object);
      } catch (err) {
        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
