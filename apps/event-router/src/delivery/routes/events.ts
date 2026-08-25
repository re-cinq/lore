/**
 * POST /api/events — the single front door to `pipeline.events` (ADR-044).
 *
 * ONE path, two callers, because a producer should not have to know which door
 * its event qualifies for:
 *
 *   - GitHub sends its own webhook body with `X-Hub-Signature-256`. Verified by
 *     HMAC over the RAW body (hence `payload.parse = false`), then mapped by the
 *     pure `mapGitHubEvent`.
 *   - Everyone else — the Agent CR watch, human-station resumes, cron ticks,
 *     CI ingest, internal triggers — reports the generic `EventInsert` shape
 *     with a bearer token.
 *
 * The signature header decides which, and it is checked FIRST: an untrusted
 * caller and a trusted one cannot share a single hapi auth strategy, so both
 * checks run here in sequence instead. That is the cost of one front door, and
 * it is paid in this file rather than spread across every producer.
 *
 * Returns 202 fast either way — GitHub's delivery times out, and the loop does
 * the actual work. Every insert is idempotent on `dedupeKey`, so a redelivery
 * collapses to one row.
 */

import { z } from "zod";
import type { ServerRoute } from "@hapi/hapi";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { SOURCES, type EventInsert } from "@re-cinq/lore-shared";
import { rawBody } from "@re-cinq/lore-shared/http/raw-body.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import {
  parseBody,
  parseJsonBody,
} from "@re-cinq/lore-shared/http/json-body.js";
import { enforceBearer } from "@re-cinq/lore-shared/http/bearer.js";
import { mapGitHubEvent } from "@re-cinq/lore-shared/project/events/github-map.js";
import { verifyGitHubSignature } from "@re-cinq/lore-shared/http/github-signature.js";

/** The reported-event body. `source` is the closed vocabulary rather than a
 *  string: an event whose source is a typo reaches no handler, and is then found
 *  only by its absence. */
const ReportedEvent = z.object({
  eventName: z.string().min(1),
  source: z.enum(SOURCES),
  params: z.record(z.unknown()).optional(),
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
    // No hapi auth strategy: the two branches authenticate differently, and a
    // strategy would have to pick one before the handler can tell them apart.
    options: { auth: false, payload: { parse: false } },
    handler: async (request, h) => {
      const raw = rawBody(request);
      const signature = githubSignature(request.headers);

      const events = signature
        ? fromGitHub(request.headers, raw, signature, deps)
        : [fromReporter(raw, request.headers, deps)];

      // Sequential, not concurrent: a partial failure must still surface as a
      // 5xx so the sender retries, and every insert is idempotent.
      for (const event of events) {
        await deps.insert(event);
      }

      return h
        .response({
          captured: events.length,
          events: events.map((e) => e.eventName),
        })
        .code(202);
    },
  };
}

/** GitHub's own signature header, when it sent one. Its presence — not its
 *  validity — is what selects the branch; validity is the branch's own first
 *  act. Named so the choice reads as a question rather than a header lookup. */
function githubSignature(headers: Record<string, unknown>): string | undefined {
  const sig = headers["x-hub-signature-256"];

  return typeof sig === "string" ? sig : undefined;
}

/** The GitHub branch: verify over the raw body, then map. */
function fromGitHub(
  headers: Record<string, unknown>,
  raw: string,
  signature: string,
  deps: EventsRouteDeps,
): EventInsert[] {
  const eventType = headers["x-github-event"] as string | undefined;
  const deliveryId = (headers["x-github-delivery"] as string | undefined) ?? "";

  // Each refusal names the thing to go and change: these reach a webhook
  // delivery log nobody reads with the code open, so "invalid signature" costs
  // more to diagnose than the sentence saying which two secrets disagree.
  enforceTrue(
    deps.webhookSecret,
    // 500, not 503: 503 tells GitHub to redeliver, and no number of
    // redeliveries supplies a missing env var. The fix is a redeploy.
    apiError(500),
    "webhook secret not configured — set LORE_WEBHOOK_SECRET on the event-router deployment",
  );
  enforceTrue(
    verifyGitHubSignature(deps.webhookSecret, signature, raw),
    apiError(401),
    "signature verification failed — LORE_WEBHOOK_SECRET and the secret on the GitHub webhook do not match",
  );
  enforceTrue(eventType, apiError(400), "missing x-github-event header");

  return mapGitHubEvent(
    eventType,
    parseJsonBody(raw, "webhook body"),
    deliveryId,
  );
}

/** The reporting branch: bearer token, then the generic shape. */
function fromReporter(
  raw: string,
  headers: Record<string, unknown>,
  deps: EventsRouteDeps,
): EventInsert {
  enforceBearer(headers, deps.bearerToken, "event-router");

  return parseBody(raw, ReportedEvent, "reportable event");
}
