// Shared plumbing every feature route uses: the base path, the write-payload cap, the repo-param reader, and the error-mapping wrapper.

import type { ResponseToolkit, ResponseObject } from "@hapi/hapi";
import { rethrowBoom } from "../../../server/api-error.js";
import { ValidationError } from "@re-cinq/lore-shared/feature-planning/feature-input.js";

export const BASE = "/api/repos/{owner}/{repo}/features";

export const repoOf = (p: Record<string, string>) => `${p.owner}/${p.repo}`;
// hapi parses the payload natively (ADR-034); the 2 MB cap surfaces as a 413.
export const WRITE_PAYLOAD = { maxBytes: 2 * 1_048_576 } as const;

/** ValidationError → 400, else → 500; Boom passes through with its guard's status. */
export async function run(
  h: ResponseToolkit,
  fn: () => Promise<ResponseObject>,
): Promise<ResponseObject> {
  try {
    return await fn();
  } catch (err) {
    rethrowBoom(err);

    if (err instanceof ValidationError) {
      return h.response({ error: err.message }).code(400);
    }

    return h
      .response({ error: err instanceof Error ? err.message : String(err) })
      .code(500);
  }
}
