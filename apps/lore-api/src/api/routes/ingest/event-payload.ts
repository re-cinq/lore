import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { rethrowBoom, apiError } from "../../../server/api-error.js";
import { z } from "zod";
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
/** The stored event params, verbatim — shape varies by event name. */
const EventPayloadSchema = z.record(z.unknown());

export function eventPayloadRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/events/{id}/payload",
    options: zodResponse(bearerScope("read"), EventPayloadSchema, {
      name: "EventPayload",
      description: "One event's stored params",
      errors: [404],
    }),
    handler: async (request, h) => {
      try {
        const repo = `${request.params.owner}/${request.params.repo}`;
        const pool = getPool();

        enforceTrue(pool, apiError(503), "db not configured");
        const { rows } = await pool.query(
          `SELECT params->'payload' AS payload, repo
             FROM pipeline.events
            WHERE id = $1`,
          [request.params.id],
        );
        const row = rows[0] as
          { payload: unknown; repo: string | null } | undefined;

        enforceTrue(
          row && row.payload != null && row.repo === repo,
          apiError(404),
          "not found",
        );

        return h.response(row.payload as object);
      } catch (err) {
        // A guard's refusal already carries its status; only an unexpected failure
        // is this block's to shape.
        rethrowBoom(err);

        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
