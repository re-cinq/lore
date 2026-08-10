/**
 * Floor's HTTP server (hapi). Mounts the webhook ingress, the agent-telemetry
 * sink, and the /healthz probe — one route per file under ./routes. Built by
 * `buildServer` (no listen — used by inject() tests) and run by
 * `startHealthServer` (the name/signature index.ts already calls).
 */

import Hapi from "@hapi/hapi";
import { registerBearerAuth } from "./auth.js";
import { registerRequestTracing } from "./tracing.js";
import { healthRoute } from "./routes/health.js";
import { agentEventsRoute } from "./routes/agent-events.js";
import { agentLogsRoute } from "./routes/agent-logs.js";
import { agentEventsStreamRoute } from "./routes/agent-events-stream.js";
import { agentEventsHistoryRoute } from "./routes/agent-events-history.js";
import { assemblyLineDefinitionsRoute } from "./routes/assembly-line-definitions.js";
import { githubWebhookRoute } from "./routes/github-webhook.js";
import { ciIngestRoute } from "./routes/ci-ingest.js";
import { ciTestsRoute } from "./routes/ci-tests.js";
import { reviewStartRoute } from "./routes/review-start.js";
import { anthropicCostLiveRoute } from "./routes/anthropic-cost-live.js";
import type {
  PodLogSource,
  PodLogArchive,
} from "../../jobs/station/agent-pod-logs.js";

// GitHub caps webhook payloads at 25 MB; the old raw `node:http` server read the
// body unbounded. Bound it generously rather than at hapi's 1 MB default, which
// would reject large push deliveries that used to work.
const MAX_BODY_BYTES = 25 * 1024 * 1024;

export function buildServer(opts: {
  getJobStatus: () => unknown;
  port?: number;
  podLogSource?: PodLogSource;
  podLogArchive?: PodLogArchive;
}): Hapi.Server {
  const server = Hapi.server({
    port: opts.port ?? 0,
    host: "0.0.0.0",
    routes: { payload: { maxBytes: MAX_BODY_BYTES } },
  });

  registerRequestTracing(server);
  registerBearerAuth(server);
  server.route([
    healthRoute(opts.getJobStatus),
    agentEventsRoute,
    agentEventsStreamRoute(),
    agentEventsHistoryRoute(),
    assemblyLineDefinitionsRoute(),
    agentLogsRoute(opts.podLogSource, opts.podLogArchive),
    githubWebhookRoute,
    ciIngestRoute,
    ciTestsRoute,
    reviewStartRoute,
    anthropicCostLiveRoute(),
  ]);

  return server;
}

export async function startHealthServer(
  port: number,
  getJobStatus: () => unknown,
): Promise<void> {
  const server = buildServer({ getJobStatus, port });

  process.on("SIGTERM", () => {
    void server.stop();
  });

  try {
    await server.start();
    console.log(`[floor] Health server on :${port}/healthz`);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;

    if (e.code === "EADDRINUSE") {
      console.error(
        `[floor] Health server port ${port} already in use — another agent instance is running. Exiting.`,
      );
    } else {
      console.error("[floor] Health server error:", err);
    }
    process.exit(1);
  }
}
