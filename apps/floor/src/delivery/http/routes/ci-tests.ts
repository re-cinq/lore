/**
 * POST /api/webhook/ci-tests — the Layer-1 test-report ingest producer. The
 * lore-code-trace binary bearer-authenticates (LORE_INGEST_TOKEN via the
 * ingest-token strategy); the pure `mapCiTests` turns the body into a test-report
 * event and we INSERT it; the loop dispatches. `payload.parse = false` so the body
 * is parsed as JSON regardless of Content-Type, matching the old handler.
 */

import { enforceOk } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../api-error.js";
import type { ServerRoute } from "@hapi/hapi";
import {
  mapCiTests,
  type CiTestsBody,
} from "../../../listeners/ci-tests-map.js";
import { insertEventList } from "../../../main-loop/store.js";
import { rawBody, parseJsonBody } from "../raw-body.js";

export const ciTestsRoute: ServerRoute = {
  method: "POST",
  path: "/api/webhook/ci-tests",
  options: { auth: "ingest-token", payload: { parse: false } },
  handler: async (request, h) => {
    const mapped = mapCiTests(parseJsonBody<CiTestsBody>(rawBody(request)));

    // A validation failure is a client error — a 400 surfaces the
    // mapper's 400 + message instead of a generic 500.
    enforceOk(mapped, apiError(400));

    await insertEventList(mapped.events, "ci-tests");

    return h.response({ ingested: mapped.events.length }).code(202);
  },
};
