/**
 * Body helpers for the Floor HTTP server.
 *
 * `rawBody` / `rawBytes` live in `@re-cinq/lore-shared` — they were byte-identical
 * here and in lore-api (#1051). Re-exported rather than re-imported at each call
 * site so the ~20 route modules keep one import path.
 */

import { apiError } from "./api-error.js";

export { rawBody, rawBytes } from "@re-cinq/lore-shared/http/raw-body.js";

/**
 * Parse a raw request body as JSON, or throw a 400 (`apiError(400)`). Routes
 * set `payload.parse = false` and parse the body themselves so it works
 * regardless of the request's Content-Type.
 *
 * `source` names the calling ingress. Five routes parse bodies this way, so a
 * bare "invalid JSON" in the log said a body was rejected without saying WHICH
 * ingress rejected it. The parser's own complaint rides along too — V8 names the
 * offending position where it can work one out, and re-deriving that here would
 * be a worse copy of what the SyntaxError already holds.
 */
export function parseJsonBody<T = unknown>(raw: string, source: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);

    throw apiError(400)(`invalid JSON in ${source} body: ${detail}`);
  }
}
