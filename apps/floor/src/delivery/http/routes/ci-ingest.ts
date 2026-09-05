/** POST /api/webhook/ci-ingest — Layer-1 doc-projection producer: CI bearer-authenticates, `mapCiIngest` turns the body into events we INSERT, the loop dispatches. `payload.parse: false` so the body parses as JSON regardless of Content-Type. */

import { enforceOk } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../api-error.js";
import type { ServerRoute } from "@hapi/hapi";
import {
  mapCiIngest,
  type CiIngestBody,
} from "../../../listeners/ci-ingest-map.js";
import { insertEventList } from "../../../kernel/event-store.js";
import { rawBody, parseJsonBody } from "../raw-body.js";

export const ciIngestRoute: ServerRoute = {
  method: "POST",
  path: "/api/webhook/ci-ingest",
  options: { auth: "ingest-token", payload: { parse: false } },
  handler: async (request, h) => {
    const mapped = mapCiIngest(
      parseJsonBody<CiIngestBody>(rawBody(request), "ci-ingest"),
    );

    // A validation failure is a client error — 400 surfaces the mapper's message instead of a generic 500.
    enforceOk(mapped, apiError(400));

    // Idempotent only via dedupe_key, which doc projection omits on purpose (force must re-run) — return 202 fast, the loop does the work.
    await insertEventList(mapped.events, "ci-ingest");

    return h
      .response({ triggered: mapped.events.map((e) => e.params?.kind) })
      .code(202);
  },
};
