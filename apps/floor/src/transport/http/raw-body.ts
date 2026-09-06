/** Body helpers: re-export from shared (#1051) so route modules share one import path. */

import { apiError } from "./api-error.js";

export { rawBody, rawBytes } from "@re-cinq/lore-shared/http/raw-body.js";

/** Parse JSON or throw 400; source names ingress for better logging. */
export function parseJsonBody<T = unknown>(raw: string, source: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);

    throw apiError(400)(`invalid JSON in ${source} body: ${detail}`);
  }
}
