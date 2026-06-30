/**
 * Floor's HTTP server (hapi). Mounts the webhook ingress, the agent-telemetry
 * sink, and the /healthz probe — one route per file under ./routes. Built by
 * `buildServer` (no listen — used by inject() tests) and run by
 * `startHealthServer` (the name/signature index.ts already calls).
 */

import Hapi from "@hapi/hapi";
import { registerBearerAuth } from "./auth.js";
import { healthRoute } from "./routes/health.js";
import { agentEventsRoute } from "./routes/agent-events.js";
import { githubWebhookRoute } from "./routes/github-webhook.js";
import { ciIngestRoute } from "./routes/ci-ingest.js";
import { ciTestsRoute } from "./routes/ci-tests.js";

// GitHub caps webhook payloads at 25 MB; the old raw `node:http` server read the
// body unbounded. Bound it generously rather than at hapi's 1 MB default, which
// would reject large push deliveries that used to work.
const MAX_BODY_BYTES = 25 * 1024 * 1024;

export function buildServer(opts: { getJobStatus: () => unknown; port?: number }): Hapi.Server {
  const server = Hapi.server({
    port: opts.port ?? 0,
    host: "0.0.0.0",
    routes: { payload: { maxBytes: MAX_BODY_BYTES } },
  });

  registerBearerAuth(server);
  server.route([
    healthRoute(opts.getJobStatus),
    agentEventsRoute,
    githubWebhookRoute,
    ciIngestRoute,
    ciTestsRoute,
  ]);

  return server;
}

export async function startHealthServer(port: number, getJobStatus: () => unknown): Promise<void> {
  const server = buildServer({ getJobStatus, port });

  process.on("SIGTERM", () => {
    void server.stop();
  });

  try {
    await server.start();
    console.log(`[agent] Health server on :${port}/healthz`);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EADDRINUSE") {
      console.error(
        `[agent] Health server port ${port} already in use — another agent instance is running. Exiting.`,
      );
    } else {
      console.error("[agent] Health server error:", err);
    }
    process.exit(1);
  }
}
