/** POST /api/events (ADR-044): one front door, GitHub or bearer; 202 fast, deduped on dedupeKey. */

import { z } from "zod";
import type { Lifecycle, ServerRoute } from "@hapi/hapi";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { SOURCES, type EventInsert } from "@re-cinq/lore-shared";
import { rawBody } from "@re-cinq/lore-shared/http/raw-body.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import {
  parseBody,
  parseJsonBody,
} from "@re-cinq/lore-shared/http/json-body.js";
import { mapGitHubEvent } from "@re-cinq/lore-shared/project/events/github-map.js";
import { verifyGitHubSignature } from "@re-cinq/lore-shared/http/github-signature.js";
import { enforceReporterToken } from "./reporter-auth.js";
import type { ReporterAuthDeps } from "./reporter-auth.js";

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
  /** The cluster-agent registry lookup (FR5): bearer token validated against pipeline.cluster_agents.token_hash. */
  findByTokenHash?: ReporterAuthDeps["findByTokenHash"];
}

// Captures one delivery, from either branch. The inserts are SEQUENTIAL on purpose: a partial failure surfaces as a 5xx so the sender retries the whole delivery, and every insert is idempotent, so a retry costs nothing.
function captureHandler(deps: EventsRouteDeps): Lifecycle.Method {
  return async (request, h) => {
    const raw = rawBody(request);
    const signature = githubSignature(request.headers);
    const events = signature
      ? fromGitHub(request.headers, raw, signature, deps)
      : [await fromReporter(raw, request.headers, deps)];

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

export function eventsRoute(deps: EventsRouteDeps): ServerRoute {
  return {
    method: "POST",
    path: "/api/events",
    // No hapi auth: two branches authenticate differently; strategy can't pick before handler.
    options: { auth: false, payload: { parse: false } },
    handler: captureHandler(deps),
  };
}

/** GitHub's signature header (presence selects branch); validity checked by branch itself. */
function githubSignature(headers: Record<string, unknown>): string | undefined {
  const sig = headers["x-hub-signature-256"];

  return typeof sig === "string" ? sig : undefined;
}

// The three things that must hold before a GitHub body is trusted. Each error names what to fix, because these are read in a delivery log rather than at a terminal: a 500 for the missing secret (503 would tell GitHub to redeliver, but an unset env var needs a redeploy), a 401 for a mismatch, a 400 for a body with no event type.
function enforceGitHubDelivery(
  eventType: string | undefined,
  raw: string,
  signature: string,
  deps: EventsRouteDeps,
): string {
  enforceTrue(
    deps.webhookSecret,
    apiError(500),
    "webhook secret not configured — set LORE_WEBHOOK_SECRET on the event-router deployment",
  );
  enforceTrue(
    verifyGitHubSignature(deps.webhookSecret, signature, raw),
    apiError(401),
    "signature verification failed — LORE_WEBHOOK_SECRET and the secret on the GitHub webhook do not match",
  );
  enforceTrue(eventType, apiError(400), "missing x-github-event header");

  return eventType;
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

  return mapGitHubEvent(
    enforceGitHubDelivery(eventType, raw, signature, deps),
    parseJsonBody(raw, "webhook body"),
    deliveryId,
  );
}

/** The reporting branch: validate ingest or per-agent token, return generic shape. */
async function fromReporter(
  raw: string,
  headers: Record<string, unknown>,
  deps: EventsRouteDeps,
): Promise<EventInsert> {
  await enforceReporterToken(headers, {
    ingestToken: deps.bearerToken,
    findByTokenHash: deps.findByTokenHash,
  });

  return parseBody(raw, ReportedEvent, "reportable event");
}
