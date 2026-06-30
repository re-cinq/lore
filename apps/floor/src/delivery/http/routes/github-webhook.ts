/**
 * POST /api/webhook/github — the Layer-1 GitHub webhook ingress. Verifies the
 * HMAC signature over the RAW body (hence `payload.parse = false`), maps the
 * payload to events (pure `mapGitHubEvent`), and INSERTs them idempotently on
 * the X-GitHub-Delivery id. It only writes rows; the loop dispatches. Returns
 * 202 fast so GitHub's delivery doesn't time out.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import Boom from "@hapi/boom";
import type { ServerRoute } from "@hapi/hapi";
import { mapGitHubEvent } from "../../../listeners/github-map.js";
import { insertEvent } from "../../../main-loop/store.js";
import { rawBody } from "../raw-body.js";

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

    if (!secret) throw Boom.serverUnavailable("webhook secret not configured");
    if (!signature) throw Boom.unauthorized("missing signature");
    if (!verifyGitHubSignature(secret, signature, raw)) throw Boom.unauthorized("invalid signature");
    if (!eventType) throw Boom.badRequest("missing x-github-event header");

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw Boom.badRequest("invalid JSON");
    }

    const events = mapGitHubEvent(eventType, payload, deliveryId);
    // Insert sequentially; each is idempotent (ON CONFLICT on dedupe_key). The loop
    // does the work — return 202 fast so GitHub's delivery doesn't time out.
    for (const ev of events) {
      await insertEvent(ev).catch((err) =>
        console.error(`[events] github insert failed (${ev.eventName}):`, err),
      );
    }
    return h.response({ captured: events.length, events: events.map((e) => e.eventName) }).code(202);
  },
};
