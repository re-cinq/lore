/** POST /api/webhook/github: GitHub's deliveries, verified by HMAC and written to `pipeline.events` deduped on the delivery id. */

import { z } from "zod";
import type { Pool } from "pg";
import type { Lifecycle, ServerRoute } from "@hapi/hapi";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { MAX_SERVER_BODY_BYTES } from "@re-cinq/lore-shared/http/body-limits.js";
import {
  eventsFromGitHubDelivery,
  githubSignature,
} from "@re-cinq/lore-shared/http/github-delivery.js";
import { rawBody } from "@re-cinq/lore-shared/http/raw-body.js";
import { GITHUB_WEBHOOK_PATH } from "../../http/rate-limit.js";
import { zodResponse } from "../../http/zod-response.js";
import { eventReporterFor } from "../event-reporter.js";

const CapturedSchema = z.object({
  captured: z.number(),
  events: z.array(z.string()),
});

// Auth-exempt: GitHub verifies itself via the HMAC signature. The body is read raw because the signature covers its bytes, and GitHub's payloads outgrow the JSON limit of the other routes.
const DELIVERY_OPTIONS = zodResponse(
  { auth: false, payload: { parse: false, maxBytes: MAX_SERVER_BODY_BYTES } },
  CapturedSchema,
  {
    name: "GitHubDeliveryCaptured",
    status: 202,
    description: "The bus events the delivery was mapped to",
    errors: [400, 401],
  },
);

export function githubWebhookRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: GITHUB_WEBHOOK_PATH,
    options: DELIVERY_OPTIONS,
    handler: captureDelivery(getPool),
  };
}

// Inserts run SEQUENTIALLY so a partial failure is a 5xx the sender redelivers whole; every insert is idempotent on the delivery id, so the redelivery is free.
function captureDelivery(getPool: () => Pool | null): Lifecycle.Method {
  return async (request, h) => {
    const events = deliveredEvents(request.headers, rawBody(request));
    const reporter = eventReporterFor(getPool());

    for (const event of events) {
      await reporter.insert(event);
    }
    const body = {
      captured: events.length,
      events: events.map((event) => event.eventName),
    };

    return h.response(body).code(202);
  };
}

function deliveredEvents(headers: Record<string, unknown>, raw: string) {
  const signature = githubSignature(headers);

  enforceTrue(signature, apiError(401), "missing x-hub-signature-256 header");

  return eventsFromGitHubDelivery(headers, raw, signature, {
    webhookSecret: process.env.LORE_WEBHOOK_SECRET,
    service: "lore-api",
  });
}
