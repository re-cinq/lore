/**
 * POST /api/webhook/ci-tests — the Layer-1 test-report ingest producer. The
 * lore-code-trace binary bearer-authenticates (LORE_INGEST_TOKEN via the
 * ingest-token strategy); the pure `mapCiTests` turns the body into a test-report
 * event and we INSERT it; the loop dispatches. `payload.parse = false` so the body
 * is parsed as JSON regardless of Content-Type, matching the old handler.
 */

import Boom from "@hapi/boom";
import type { ServerRoute } from "@hapi/hapi";
import { mapCiTests, type CiTestsBody } from "../../../listeners/ci-tests-map.js";
import { insertEvent } from "../../../main-loop/store.js";
import { rawBody, parseJsonBody } from "../raw-body.js";

export const ciTestsRoute: ServerRoute = {
  method: "POST",
  path: "/api/webhook/ci-tests",
  options: { auth: "ingest-token", payload: { parse: false } },
  handler: async (request, h) => {
    const mapped = mapCiTests(parseJsonBody<CiTestsBody>(rawBody(request)));
    if (!mapped.ok) throw new Boom.Boom(mapped.error, { statusCode: mapped.status });

    for (const ev of mapped.events) {
      await insertEvent(ev).catch((err) =>
        console.error("[events] ci-tests insert failed:", err),
      );
    }
    return h.response({ ingested: mapped.events.length }).code(202);
  },
};
