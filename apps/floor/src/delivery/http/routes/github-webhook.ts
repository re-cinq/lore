/**
 * POST /api/webhook/github — the Layer-1 GitHub webhook ingress. Verifies the
 * HMAC signature over the RAW body (hence `payload.parse = false`), maps the
 * payload to events (pure `mapGitHubEvent`), and INSERTs them idempotently on
 * the X-GitHub-Delivery id. It only writes rows; the loop dispatches. Returns
 * 202 fast so GitHub's delivery doesn't time out.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import Boom from "@hapi/boom";
import type { ServerRoute } from "@hapi/hapi";
import { mapGitHubEvent } from "../../../listeners/github-map.js";
import { insertEventList } from "../../../main-loop/store.js";
import { rawBody, parseJsonBody } from "../raw-body.js";

export function verifyGitHubSignature(secret: string, signature: string, body: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
}

export const githubWebhookRoute: ServerRoute = {
  method: "POST",
  path: "/api/webhook/github",
  options: { auth: false, payload: { parse: false } },
  handler: async (request, h) => {
    const secret = process.env.LORE_WEBHOOK_SECRET;
    const signature = request.headers["x-hub-signature-256"] as string | undefined;
    const eventType = request.headers["x-github-event"] as string | undefined;
    const deliveryId = (request.headers["x-github-delivery"] as string | undefined) ?? "";
    const raw = rawBody(request);

    /// todo: The signature of this enforce must be: enforceTrue(condition, error type, error message)
    enforceTrue(secret, () => Boom.serverUnavailable("webhook secret not configured"));
    enforceTrue(signature, () => Boom.unauthorized("missing signature"));
    enforceTrue(verifyGitHubSignature(secret, signature, raw), () => Boom.unauthorized("invalid signature"));
    enforceTrue(eventType, () => Boom.badRequest("missing x-github-event header"));

    const events = mapGitHubEvent(eventType, parseJsonBody(raw), deliveryId);
    // Each insert is idempotent (ON CONFLICT on dedupe_key). The loop does the
    // work — return 202 fast so GitHub's delivery doesn't time out.
    await insertEventList(events, "github");
    return h.response({ captured: events.length, events: events.map((e) => e.eventName) }).code(202);
  },
};
