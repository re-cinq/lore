/** POST /api/events (ADR-044): one front door, GitHub or bearer; 202 fast, deduped on dedupeKey. */

import { z } from "zod";
import type { Lifecycle, ServerRoute } from "@hapi/hapi";
import { SOURCES, type EventInsert } from "@re-cinq/lore-shared";
import { rawBody } from "@re-cinq/lore-shared/http/raw-body.js";
import { parseBody } from "@re-cinq/lore-shared/http/json-body.js";
import {
  eventsFromGitHubDelivery,
  githubSignature,
  type GitHubDoor,
} from "@re-cinq/lore-shared/http/github-delivery.js";
import { enforceBearer } from "@re-cinq/lore-shared/http/bearer.js";

/** Reported-event body: source is closed vocabulary to catch typos as absences. */
const ReportedEvent = z.object({
  eventName: z.string().min(1),
  source: z.enum(SOURCES),
  params: z.record(z.string(), z.unknown()).optional(),
  dedupeKey: z.string().min(1).optional(),
});

export interface EventsRouteDeps {
  insert: (event: EventInsert) => Promise<void>;
  /** The GitHub webhook secret; absent means the webhook branch is unconfigured. */
  webhookSecret?: string;
  /** The token the reporting branch accepts; absent means it is unconfigured. */
  bearerToken?: string;
}

export function eventsRoute(deps: EventsRouteDeps): ServerRoute {
  return {
    method: "POST",
    path: "/api/events",
    // No hapi auth: two branches authenticate differently; strategy can't pick before handler.
    options: { auth: false, payload: { parse: false } },
    handler: captureHandler(deps),
  };
}

// Inserts run SEQUENTIALLY so a partial failure is a 5xx the sender retries whole; every insert is idempotent, so the retry is free.
function captureHandler(deps: EventsRouteDeps): Lifecycle.Method {
  return async (request, h) => {
    const raw = rawBody(request);
    const signature = githubSignature(request.headers);
    const events = signature
      ? eventsFromGitHubDelivery(request.headers, raw, signature, door(deps))
      : [fromReporter(raw, request.headers, deps)];

    for (const event of events) {
      await deps.insert(event);
    }

    return h
      .response({
        captured: events.length,
        events: events.map((e) => e.eventName),
      })
      .code(202);
  };
}

function door(deps: EventsRouteDeps): GitHubDoor {
  return { webhookSecret: deps.webhookSecret, service: "event-router" };
}

/** The reporting branch: validate the bus-wide token, return generic shape. */
function fromReporter(
  raw: string,
  headers: Record<string, unknown>,
  deps: EventsRouteDeps,
): EventInsert {
  enforceBearer(headers, deps.bearerToken, "event-router");

  return parseBody(raw, ReportedEvent, "reportable event");
}
