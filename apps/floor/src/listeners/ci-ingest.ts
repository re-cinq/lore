/**
 * Layer-1 CI-ingest listener — the doc-projection producer, moved into Floor from
 * mcp-server's POST /api/repos/:o/:r/ingest-graph. A repo's CI bearer-authenticates
 * (LORE_INGEST_TOKEN — the same token it already holds), the pure `mapCiIngest`
 * turns the body into events, and we INSERT them; the loop dispatches. Mounted on
 * Floor's HTTP server at POST /api/webhook/ci-ingest.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { mapCiIngest, type CiIngestBody } from "./ci-ingest-map.js";
import { insertEvent } from "../main-loop/store.js";

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

export async function handleCiIngestWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const expected = process.env.LORE_INGEST_TOKEN;
  const bearer = req.headers.authorization?.replace("Bearer ", "");
  if (!expected) return send(res, 503, { error: "ingest token not configured" });
  if (bearer !== expected) return send(res, 401, { error: "unauthorized" });

  let body: CiIngestBody;
  try {
    body = JSON.parse(await readBody(req)) as CiIngestBody;
  } catch {
    return send(res, 400, { error: "invalid JSON" });
  }

  const mapped = mapCiIngest(body);
  if (!mapped.ok) return send(res, mapped.status, { error: mapped.error });

  // Each insert is idempotent only via dedupe_key, which doc projection omits on
  // purpose (force must re-run); the loop does the work — return 202 fast.
  for (const ev of mapped.events) {
    await insertEvent(ev).catch((err) =>
      console.error(`[events] ci-ingest insert failed (${ev.params?.kind}):`, err),
    );
  }
  send(res, 202, { triggered: mapped.events.map((e) => e.params?.kind) });
}
