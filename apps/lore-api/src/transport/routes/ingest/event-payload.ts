import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { zodResponse } from "../../http/zod-response.js";
import { rethrowBoom, apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { z } from "zod";
import { errorMessage } from "@re-cinq/lore-shared";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import type { Pool } from "pg";
import { bearerScope } from "../../http/bearer-scope.js";

/** Ingest station's payload-by-reference fetch (~1MB too large for argv). */
/** The stored event params, verbatim — shape varies by event name. */
const EventPayloadSchema = z.record(z.string(), z.unknown());

/** Reads one event's stored payload, refusing when the row belongs to another repo. */
async function readEventPayload(
  pool: Pool,
  id: string,
  repo: string,
): Promise<object> {
  const { rows } = await pool.query(
    `SELECT params->'payload' AS payload, repo
       FROM pipeline.events
      WHERE id = $1`,
    [id],
  );
  const row = rows[0] as { payload: unknown; repo: string | null } | undefined;

  enforceTrue(
    row && row.payload != null && row.repo === repo,
    apiError(404),
    "not found",
  );

  return row.payload as object;
}

/** The body of one scheduling event, fetched BY REFERENCE: an ingest pod is handed an event id rather than a payload, so a large report never rides through the dispatch. */
async function serveEventPayload(
  getPool: () => Pool | null,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  try {
    const { owner, repo: name, id } = request.params;
    const pool = getPool();

    enforceTrue(pool, apiError(503), "db not configured");

    return h.response(await readEventPayload(pool, id, `${owner}/${name}`));
  } catch (err) {
    // Guard refusals carry their status; shape only unexpected failures.
    rethrowBoom(err);

    return h.response({ error: errorMessage(err) }).code(500);
  }
}

export function eventPayloadRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/events/{id}/payload",
    options: zodResponse(bearerScope("read"), EventPayloadSchema, {
      name: "EventPayload",
      description: "One event's stored params",
      errors: [404],
    }),
    handler: (request, h) => serveEventPayload(getPool, request, h),
  };
}
