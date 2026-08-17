/**
 * Body helpers for the Floor HTTP server.
 *
 * `rawBody` / `rawBytes` live in `@re-cinq/lore-shared` — they were byte-identical
 * here and in lore-api (#1051). Re-exported rather than re-imported at each call
 * site so the ~20 route modules keep one import path.
 */

import Boom from "@hapi/boom";

export { rawBody, rawBytes } from "@re-cinq/lore-shared/http/raw-body.js";

/**
 * Parse a raw request body as JSON, or throw a 400 (`Boom.badRequest`). Routes
 * set `payload.parse = false` and parse the body themselves so it works
 * regardless of the request's Content-Type.
 */
export function parseJsonBody<T = unknown>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // TODO: we must say where the invalid json is coming from. We can add a parameter to this function that will be the name of the route that is calling it. This way we can have a more actionable error message. Also, we need to tell the client where the error is in the request body.
    throw Boom.badRequest("invalid JSON");
  }
}
