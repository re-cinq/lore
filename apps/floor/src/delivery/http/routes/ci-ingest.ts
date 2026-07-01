/**
 * POST /api/webhook/ci-ingest — the Layer-1 doc-projection producer. A repo's CI
 * bearer-authenticates (LORE_INGEST_TOKEN via the ingest-token strategy); the
 * pure `mapCiIngest` turns the body into events and we INSERT them; the loop
 * dispatches. `payload.parse = false` so the body is parsed as JSON regardless of
 * the request's Content-Type, matching the old hand-rolled handler.
 */

import Boom from "@hapi/boom";
import type { ServerRoute } from "@hapi/hapi";
import { enforceOk } from "@re-cinq/lore-shared/lib/enforce.js";
import { mapCiIngest, type CiIngestBody } from "../../../listeners/ci-ingest-map.js";
import { insertEvent } from "../../../main-loop/store.js";
import { rawBody, parseJsonBody } from "../raw-body.js";

export const ciIngestRoute: ServerRoute = {
  method: "POST",
  path: "/api/webhook/ci-ingest",
  options: { auth: "ingest-token", payload: { parse: false } },
  handler: async (request, h) => {
    const mapped = mapCiIngest(parseJsonBody<CiIngestBody>(rawBody(request)));
    enforceOk(mapped, (f) => new Boom.Boom(f.error, { statusCode: f.status }));

    // Each insert is idempotent only via dedupe_key, which doc projection omits on
    // purpose (force must re-run); the loop does the work — return 202 fast.
    for (const ev of mapped.events) {
      await insertEvent(ev).catch((err) =>
        console.error(`[events] ci-ingest insert failed (${ev.params?.kind}):`, err),
      );
    }
    return h.response({ triggered: mapped.events.map((e) => e.params?.kind) }).code(202);
  },
};
