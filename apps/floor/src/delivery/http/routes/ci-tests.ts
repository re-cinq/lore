/** POST /api/webhook/ci-tests — Layer-1 test-report ingest producer: lore-code-trace bearer-authenticates, `mapCiTests` maps the body to an event we INSERT, the loop dispatches. */

import { enforceOk } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../api-error.js";
import type { ServerRoute } from "@hapi/hapi";
import {
  mapCiTests,
  type CiTestsBody,
} from "../../../listeners/ci-tests-map.js";
import { insertEventList } from "../../../kernel/event-store.js";
import { rawBody, parseJsonBody } from "../raw-body.js";

export const ciTestsRoute: ServerRoute = {
  method: "POST",
  path: "/api/webhook/ci-tests",
  options: { auth: "ingest-token", payload: { parse: false } },
  handler: async (request, h) => {
    const mapped = mapCiTests(
      parseJsonBody<CiTestsBody>(rawBody(request), "ci-tests"),
    );

    // A validation failure is a client error — 400 surfaces the mapper's message instead of a generic 500.
    enforceOk(mapped, apiError(400));

    await insertEventList(mapped.events, "ci-tests");

    return h.response({ ingested: mapped.events.length }).code(202);
  },
};
