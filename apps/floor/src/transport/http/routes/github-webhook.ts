// POST /api/webhook/github — Layer-1 GitHub webhook ingress: verifies the HMAC over the RAW body, maps to events, INSERTs idempotently on X-GitHub-Delivery id, and returns 202 fast (the loop dispatches, this only writes rows).

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../api-error.js";
import type { ServerRoute, Request } from "@hapi/hapi";
import { mapGitHubEvent } from "@re-cinq/lore-shared/project/events/github-map.js";
import { verifyGitHubSignature } from "@re-cinq/lore-shared/http/github-signature.js";
import { insertEventList } from "../../../outbound/event-store.js";
import { rawBody, parseJsonBody } from "../raw-body.js";

/** Verifies the delivery is really GitHub's, and returns what identifies it. Each refusal NAMES the thing to change: these land in a webhook delivery log read by someone who does not have the code open. */
function authenticateDelivery(
  request: Request,
  raw: string,
): { eventType: string; deliveryId: string } {
  const secret = process.env.LORE_WEBHOOK_SECRET;
  const signature = request.headers["x-hub-signature-256"] as
    string | undefined;
  const eventType = request.headers["x-github-event"] as string | undefined;

  enforceTrue(
    secret,
    // 500, not 503: 503 tells GitHub to redeliver, and no redelivery supplies a missing env var — the fix is a redeploy.
    apiError(500),
    "webhook secret not configured — set LORE_WEBHOOK_SECRET on the lore-floor deployment",
  );
  enforceTrue(
    signature,
    apiError(401),
    "missing signature — GitHub must send the x-hub-signature-256 header; check the webhook is configured with a secret",
  );
  enforceTrue(
    verifyGitHubSignature(secret, signature, raw),
    apiError(401),
    "signature verification failed — LORE_WEBHOOK_SECRET and the secret on the GitHub webhook do not match",
  );
  enforceTrue(eventType, apiError(400), "missing x-github-event header");

  return {
    eventType,
    deliveryId:
      (request.headers["x-github-delivery"] as string | undefined) ?? "",
  };
}

export const githubWebhookRoute: ServerRoute = {
  method: "POST",
  path: "/api/webhook/github",
  options: { auth: false, payload: { parse: false } },
  handler: async (request, h) => {
    const raw = rawBody(request);
    const { eventType, deliveryId } = authenticateDelivery(request, raw);
    const events = mapGitHubEvent(
      eventType,
      parseJsonBody(raw, "github-webhook"),
      deliveryId,
    );

    // Each insert is idempotent (ON CONFLICT on dedupe_key); the loop does the work — return 202 fast so GitHub's delivery doesn't time out.
    await insertEventList(events, "github");

    return h
      .response({
        captured: events.length,
        events: events.map((e) => e.eventName),
      })
      .code(202);
  },
};
