/** POST /api/events (ADR-044): one front door, GitHub or bearer; 202 fast, deduped on dedupeKey. */

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
import { mapGitHubEvent } from "@re-cinq/lore-shared/project/events/github-map.js";
import { verifyGitHubSignature } from "@re-cinq/lore-shared/http/github-signature.js";
import { enforceReporterToken } from "./reporter-auth.js";
import type { ReporterAuthDeps } from "./reporter-auth.js";

/** Reported-event body: source is closed vocabulary to catch typos as absences. */
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
  /** The cluster-agent registry lookup (FR5): bearer token validated against pipeline.cluster_agents.token_hash. */
  findByTokenHash?: ReporterAuthDeps["findByTokenHash"];
}

export function eventsRoute(deps: EventsRouteDeps): ServerRoute {
  return {
    method: "POST",
    path: "/api/events",
    // No hapi auth: two branches authenticate differently; strategy can't pick before handler.
    options: { auth: false, payload: { parse: false } },
    handler: async (request, h) => {
      const raw = rawBody(request);
      const signature = githubSignature(request.headers);

      const events = signature
        ? fromGitHub(request.headers, raw, signature, deps)
        : [await fromReporter(raw, request.headers, deps)];

      // Sequential: partial failure surfaces as 5xx so sender retries; every insert is idempotent.
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

/** GitHub's signature header (presence selects branch); validity checked by branch itself. */
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

  // Errors name what to fix: delivery logs need clear messages about secret mismatches.
  enforceTrue(
    deps.webhookSecret,
    // 500 not 503: 503 tells GitHub to redeliver, but missing env var needs redeploy.
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
