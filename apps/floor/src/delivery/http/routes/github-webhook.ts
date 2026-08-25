/**
 * POST /api/webhook/github — the Layer-1 GitHub webhook ingress. Verifies the
 * HMAC signature over the RAW body (hence `payload.parse = false`), maps the
 * payload to events (pure `mapGitHubEvent`), and INSERTs them idempotently on
 * the X-GitHub-Delivery id. It only writes rows; the loop dispatches. Returns
 * 202 fast so GitHub's delivery doesn't time out.
 */

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../api-error.js";
import type { ServerRoute } from "@hapi/hapi";
import { mapGitHubEvent } from "@re-cinq/lore-shared/project/events/github-map.js";
import { verifyGitHubSignature } from "@re-cinq/lore-shared/http/github-signature.js";
import { insertEventList } from "../../../main-loop/store.js";
import { rawBody, parseJsonBody } from "../raw-body.js";

export const githubWebhookRoute: ServerRoute = {
  method: "POST",
  path: "/api/webhook/github",
  options: { auth: false, payload: { parse: false } },
  handler: async (request, h) => {
    const secret = process.env.LORE_WEBHOOK_SECRET;
    const signature = request.headers["x-hub-signature-256"] as
      string | undefined;
    const eventType = request.headers["x-github-event"] as string | undefined;
    const deliveryId =
      (request.headers["x-github-delivery"] as string | undefined) ?? "";
    const raw = rawBody(request);

    // Each refusal names the thing to go and change. These reach a webhook
    // delivery log nobody reads with the code open, so "invalid signature" cost
    // more to diagnose than the sentence that says which two secrets disagree.
    enforceTrue(
      secret,
      // 500, not 503: 503 tells GitHub to redeliver, and no number of
      // redeliveries supplies a missing env var. The fix is a redeploy.
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

    const events = mapGitHubEvent(
      eventType,
      parseJsonBody(raw, "github-webhook"),
      deliveryId,
    );

    // Each insert is idempotent (ON CONFLICT on dedupe_key). The loop does the
    // work — return 202 fast so GitHub's delivery doesn't time out.
    await insertEventList(events, "github");

    return h
      .response({
        captured: events.length,
        events: events.map((e) => e.eventName),
      })
      .code(202);
  },
};
