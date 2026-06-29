/**
 * Layer-1 GitHub webhook listener — moved into Floor from mcp-server. Verifies the
 * HMAC signature, maps the payload to events (pure `mapGitHubEvent`), and INSERTs
 * them (idempotent on the X-GitHub-Delivery id). It only writes rows; the loop
 * dispatches. Mounted on Floor's HTTP server at POST /api/webhook/github.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mapGitHubEvent } from "./github-map.js";
import { insertEvent } from "../main-loop/store.js";

export function verifyGitHubSignature(secret: string, signature: string, rawBody: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export async function handleGitHubWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const secret = process.env.LORE_WEBHOOK_SECRET;
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  const eventType = req.headers["x-github-event"] as string | undefined;
  const deliveryId = (req.headers["x-github-delivery"] as string | undefined) ?? "";
  const rawBody = await readBody(req);

  if (!secret) return send(res, 503, { error: "webhook secret not configured" });
  if (!signature) return send(res, 401, { error: "missing signature" });
  if (!verifyGitHubSignature(secret, signature, rawBody)) return send(res, 401, { error: "invalid signature" });
  if (!eventType) return send(res, 400, { error: "missing x-github-event header" });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return send(res, 400, { error: "invalid JSON" });
  }

  const events = mapGitHubEvent(eventType, payload, deliveryId);
  // Insert sequentially; each is idempotent (ON CONFLICT on dedupe_key). The loop
  // does the work — return 202 fast so GitHub's delivery doesn't time out.
  for (const ev of events) {
    await insertEvent(ev).catch((err) =>
      console.error(`[events] github insert failed (${ev.eventName}):`, err),
    );
  }
  send(res, 202, { captured: events.length, events: events.map((e) => e.eventName) });
}
