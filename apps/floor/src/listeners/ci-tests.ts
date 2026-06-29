/**
 * Layer-1 CI-tests listener — the test-report ingest producer, moved into Floor
 * from mcp-server's POST /api/repos/:o/:r/test-report. The lore-code-trace binary
 * bearer-authenticates (LORE_INGEST_TOKEN), the pure `mapCiTests` turns the body
 * into a test-report event, and we INSERT it; the loop dispatches. Mounted on
 * Floor's HTTP server at POST /api/webhook/ci-tests.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { mapCiTests, type CiTestsBody } from "./ci-tests-map.js";
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

export async function handleCiTestsWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const expected = process.env.LORE_INGEST_TOKEN;
  const bearer = req.headers.authorization?.replace("Bearer ", "");
  if (!expected) return send(res, 503, { error: "ingest token not configured" });
  if (bearer !== expected) return send(res, 401, { error: "unauthorized" });

  let body: CiTestsBody;
  try {
    body = JSON.parse(await readBody(req)) as CiTestsBody;
  } catch {
    return send(res, 400, { error: "invalid JSON" });
  }

  const mapped = mapCiTests(body);
  if (!mapped.ok) return send(res, mapped.status, { error: mapped.error });

  for (const ev of mapped.events) {
    await insertEvent(ev).catch((err) =>
      console.error("[events] ci-tests insert failed:", err),
    );
  }
  send(res, 202, { ingested: mapped.events.length });
}
